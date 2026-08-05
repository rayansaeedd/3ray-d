/*
 * Parses an Order B PDF (the "4.2 Schedule" grid pages) directly into trip records, using
 * pdf.js text-item positions rather than OCR or a hardcoded table layout.
 *
 * Core idea (generic, not hardcoded per block/page): within a block of columns (one trip
 * per column, aligned by x-position), read each row top-to-bottom for a given trip's column.
 * The FIRST row with a value for that trip is its origin (departure); the LAST is its
 * destination (arrival); everything between is an intermediate stop. This works regardless
 * of which physical stations are involved or which half of the page a trip sits in, because
 * it only relies on the documents' visual convention (journey flows top-to-bottom in the
 * table) rather than assuming "block A is always Makkah-origin" etc.
 *
 * Works both in the browser (window.PdfOrderBParser) and under Node (module.exports).
 */
(function (root) {
  "use strict";

  const TRIP_RE = /^\d{5}$/;
  const TIME_RE = /^\d{1,2}:\d{2}$/;
  const KNOWN_LABELS = ["MAKKAH", "MADINAH", "JEDDAH", "KAIA", "KAEC"];
  const LABEL_RE = new RegExp(`^(${KNOWN_LABELS.join("|")})(\\s+(ARRIVED|DEPARTURE))?$`);

  function groupIntoLines(items, yTolerance) {
    yTolerance = yTolerance || 1.5;
    const sorted = items
      .filter((it) => it.str && it.str.trim() !== "")
      .map((it) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const lines = [];
    for (const it of sorted) {
      let line = lines.find((l) => Math.abs(l.y - it.y) <= yTolerance);
      if (!line) {
        line = { y: it.y, tokens: [] };
        lines.push(line);
      }
      line.tokens.push({ str: it.str, x: it.x });
    }
    lines.forEach((l) => l.tokens.sort((a, b) => a.x - b.x));
    lines.sort((a, b) => b.y - a.y);
    return lines;
  }

  function findTripRows(lines) {
    const tripRowIdx = [];
    lines.forEach((line, i) => {
      let toks = line.tokens;
      // "No. Train" label may arrive as one token ("No. Train") or two ("No." + "Train"),
      // depending on the PDF producer -- handle both rather than assuming one.
      if (toks.length >= 1 && toks[0].str === "No. Train") {
        toks = toks.slice(1);
      } else if (toks.length >= 2 && toks[0].str === "No." && toks[1].str === "Train") {
        toks = toks.slice(2);
      }
      const tripLike = toks.filter((t) => TRIP_RE.test(t.str));
      if (tripLike.length >= 5 && tripLike.length === toks.length) {
        tripRowIdx.push({ idx: i, trips: tripLike });
      }
    });
    return tripRowIdx;
  }

  function parseLabel(str) {
    const m = LABEL_RE.exec(str);
    if (!m) return null;
    return { base: m[1], suffix: m[3] || null };
  }

  function nearestValue(tokens, x, maxDist) {
    let best = null;
    let bestDist = Infinity;
    for (const t of tokens) {
      if (!TIME_RE.test(t.str)) continue;
      const d = Math.abs(t.x - x);
      if (d < bestDist) {
        bestDist = d;
        best = t.str;
      }
    }
    if (best !== null && bestDist <= maxDist) return best;
    return null;
  }

  function detectPatternLabel(lines) {
    for (const line of lines) {
      const text = line.tokens.map((t) => t.str).join(" ");
      const m = /\(([A-Z,\s]+)\)\s*Summer Holidays\s*(\w*)/.exec(text) || /Summer Holidays\s*(\w+)/.exec(text);
      if (m) return text.trim();
    }
    return null;
  }

  function parsePageItems(items, opts) {
    opts = opts || {};
    const maxDist = opts.maxColumnDistance || 8;
    const lines = groupIntoLines(items);
    const tripRows = findTripRows(lines);
    const patternLabel = detectPatternLabel(lines);
    const trips = {};
    const warnings = [];

    for (let b = 0; b < tripRows.length; b++) {
      const blockStart = tripRows[b].idx;
      const blockEnd = b + 1 < tripRows.length ? tripRows[b + 1].idx : lines.length;
      const dataLines = lines.slice(blockStart + 1, blockEnd)
        .map((line) => ({ label: parseLabelLine(line), tokens: line.tokens }))
        .filter((l) => l.label);

      for (const { tripNo, x } of tripRows[b].trips.map((t) => ({ tripNo: t.str, x: t.x }))) {
        const stops = [];
        for (const line of dataLines) {
          const value = nearestValue(line.tokens, x, maxDist);
          if (value) stops.push({ base: line.label.base, suffix: line.label.suffix, value });
        }
        if (stops.length < 2) {
          warnings.push(`trip ${tripNo}: only ${stops.length} stop(s) found, expected at least 2 (origin+destination)`);
          continue;
        }
        const origin = stops[0];
        const destination = stops[stops.length - 1];
        const rec = {};
        rec[`${stationCode(origin.base)} Dep`] = origin.value;
        rec[`${stationCode(destination.base)} Arr`] = destination.value;

        const middle = stops.slice(1, -1);
        const byBase = {};
        for (const s of middle) {
          byBase[s.base] = byBase[s.base] || {};
          if (s.suffix === "ARRIVED") byBase[s.base].arr = s.value;
          else if (s.suffix === "DEPARTURE") byBase[s.base].dep = s.value;
        }
        for (const base in byBase) {
          const code = stationCode(base);
          if (byBase[base].arr) rec[`${code} Arr`] = byBase[base].arr;
          if (byBase[base].dep) rec[`${code} Dep`] = byBase[base].dep;
        }

        if (trips[tripNo]) {
          warnings.push(`trip ${tripNo}: appears more than once on this page, keeping first occurrence`);
        } else {
          trips[tripNo] = rec;
        }
      }
    }

    return { trips, warnings, patternLabel };
  }

  function parseLabelLine(line) {
    // The row label may be one token ("MAKKAH") or split as e.g. "JEDDAH" + "ARRIVED".
    const t0 = line.tokens[0];
    if (!t0) return null;
    let label = parseLabel(t0.str);
    if (label) return label;
    if (line.tokens.length >= 2) {
      const combined = t0.str + " " + line.tokens[1].str;
      label = parseLabel(combined);
      if (label) return label;
    }
    return null;
  }

  const STATION_CODE_MAP = { MAKKAH: "Makkah", MADINAH: "Madinah", JEDDAH: "Jeddah", KAIA: "KAIA", KAEC: "KAEC" };
  function stationCode(base) {
    return STATION_CODE_MAP[base] || base;
  }

  async function parsePdf(pdfjsLib, data, opts) {
    // Trip numbers repeat across day-patterns (WEEK/TH/FR/SA) on different pages -- these are
    // NOT guaranteed identical (not yet confirmed how circulation-day mapping works), so pages
    // are kept separate rather than merged into one trip-number-keyed dict, which would silently
    // drop or overwrite data for a repeated trip number.
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const { trips, warnings, patternLabel } = parsePageItems(tc.items, opts);
      if (Object.keys(trips).length === 0) continue; // not a schedule page (cover page, etc.)
      pages.push({
        page: p,
        patternLabel,
        trips,
        warnings: warnings.map((w) => `page ${p}: ${w}`),
      });
    }
    return { pages };
  }

  const PdfOrderBParser = { parsePdf, parsePageItems, groupIntoLines, findTripRows };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PdfOrderBParser;
  } else {
    root.PdfOrderBParser = PdfOrderBParser;
  }
})(typeof window !== "undefined" ? window : globalThis);
