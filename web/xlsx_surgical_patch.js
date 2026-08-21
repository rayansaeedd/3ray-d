/*
 * True surgical .xlsx editing: writes new values into specific cells of an existing workbook by
 * editing the raw XML text of just the affected worksheet parts inside the .xlsx zip, leaving
 * every other byte of the file (styles, drawings, external-link formulas, comments, printer
 * settings, everything) completely untouched.
 *
 * Why this exists instead of just using ExcelJS's own writer: ExcelJS reads a workbook into its
 * own in-memory model and, on write, reconstructs the entire .xlsx package from that model. For
 * the real files this engine works with, that reconstruction is provably lossy in ways that
 * corrupt the output -- confirmed directly against real uploaded files:
 *   - it drops the xl/externalLinks/* parts (and the workbook's <externalReference> declaration)
 *     on every write, even with zero edits, while leaving formula text in untouched cells still
 *     pointing at that now-undefined external reference
 *   - it only understands plain images when reading a drawing part; a ~460KB drawing full of
 *     real shapes gets rebuilt as a ~1KB stub that doesn't match what the worksheet expects,
 *     which is a hard "can't open this file" failure in real Excel, not just a warning
 * Chasing each of those one at a time doesn't scale -- there could be more. Never asking ExcelJS
 * to serialize the file at all sidesteps the entire class of problem: this module never parses
 * or understands anything about drawings, external links, comments, etc., so there's no way for
 * it to lose or mismatch them -- it only ever touches the exact `<c r="...">` elements it's told
 * to change.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./vendor/jszip.min.js"));
  } else {
    root.XlsxSurgicalPatch = factory(root.JSZip);
  }
})(typeof self !== "undefined" ? self : this, function (JSZip) {

  function colLetterToNumber(letters) {
    let n = 0;
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n;
  }

  function colNumberToLetter(num) {
    let s = "";
    while (num > 0) {
      const rem = (num - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      num = Math.floor((num - 1) / 26);
    }
    return s;
  }

  function cellAddress(row, col) {
    return colNumberToLetter(col) + row;
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  // Builds the replacement XML for a single <c> element, preserving its existing style index
  // (if any). A string value is always written as a self-contained inline string -- this avoids
  // ever touching xl/sharedStrings.xml, which is the whole point: one less part this module
  // needs to understand or keep consistent. A NUMBER is written as a genuine numeric cell (no `t`
  // attribute -- Excel's default cell type is numeric) instead: needed for a real time-of-day
  // value (e.g. a reserve task's sign-in/sign-out), which every real Task Program row already
  // stores as a true numeric serial (a fraction of a day) with a time number format on the cell's
  // style -- writing that as inlineStr text would look right but not actually BE a time cell (no
  // TIME() arithmetic, wrong sort order, mismatched type against every real row in the column).
  function buildCellXml(address, styleAttr, value) {
    if (value == null || value === "") return `<c r="${address}"${styleAttr}/>`;
    if (typeof value === "number") return `<c r="${address}"${styleAttr}><v>${value}</v></c>`;
    return `<c r="${address}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }

  // Inserts a cell that has no existing <c> element at all (a genuinely untouched, unstyled
  // cell) into its row at the correct ascending-column position. Handles three shapes a target
  // row can be in: a normal <row r="N" ...>...cells...</row>, a self-closing <row r="N" .../>
  // (formatting/height set but zero cells -- e.g. a blank row that still got a row height), or
  // no <row> element at all for that row number (a genuinely untouched row -- real spreadsheets
  // don't write XML for rows with nothing on them at all, which real Task Program files do have
  // stretches of well past the last real task row). The last case builds a fresh <row> and
  // splices it into <sheetData> in ascending row-number order, same position Excel itself would
  // keep it in.
  function insertCellIntoRow(xml, address, value, styleAttr) {
    const addrMatch = /^([A-Z]+)(\d+)$/.exec(address);
    const colLetters = addrMatch[1];
    const rowNum = addrMatch[2];
    const targetCol = colLetterToNumber(colLetters);
    const newCellXml = buildCellXml(address, styleAttr || "", value);

    const rowRe = new RegExp(`<row r="${rowNum}"([^>]*?)(?:/>|>([\\s\\S]*?)</row>)`);
    const rowMatch = rowRe.exec(xml);
    if (rowMatch) {
      const rowAttrs = rowMatch[1];
      const rowInner = rowMatch[2] || "";

      const cellRe = /<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
      let insertPos = rowInner.length;
      let cm;
      while ((cm = cellRe.exec(rowInner))) {
        if (colLetterToNumber(cm[1]) > targetCol) { insertPos = cm.index; break; }
      }
      const newRowInner = rowInner.slice(0, insertPos) + newCellXml + rowInner.slice(insertPos);
      const newRow = `<row r="${rowNum}"${rowAttrs}>${newRowInner}</row>`;
      return xml.slice(0, rowMatch.index) + newRow + xml.slice(rowMatch.index + rowMatch[0].length);
    }

    const targetRowNum = parseInt(rowNum, 10);
    const anyRowRe = /<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
    let insertPos = null;
    let rm;
    while ((rm = anyRowRe.exec(xml))) {
      if (parseInt(rm[1], 10) > targetRowNum) { insertPos = rm.index; break; }
    }
    if (insertPos == null) {
      const sheetDataCloseMatch = /<\/sheetData>/.exec(xml);
      if (!sheetDataCloseMatch) {
        throw new Error(`Row ${rowNum} has no <row> element and this sheet has no <sheetData> to add one to -- cannot place a new cell at ${address}.`);
      }
      insertPos = sheetDataCloseMatch.index;
    }
    const newRow = `<row r="${rowNum}">${newCellXml}</row>`;
    return xml.slice(0, insertPos) + newRow + xml.slice(insertPos);
  }

  // Replaces (or, failing that, inserts) the <c r="ADDRESS"> element for one cell within a
  // worksheet's raw XML text. The literal closing quote right after the address in the regex is
  // what keeps "D8" from ever matching "D80"/"D81" etc.
  function patchCellInSheetXml(xml, address, value) {
    const re = new RegExp(`<c r="${address}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
    const m = re.exec(xml);
    if (!m) return insertCellIntoRow(xml, address, value);
    const styleMatch = m[1].match(/\ss="(\d+)"/);
    const styleAttr = styleMatch ? ` s="${styleMatch[1]}"` : "";
    const newCellXml = buildCellXml(address, styleAttr, value);
    return xml.slice(0, m.index) + newCellXml + xml.slice(m.index + m[0].length);
  }

  // Reads every fill color already present in this specific file's xl/styles.xml <fills>
  // palette -- shared by every "pick a color that won't collide with this file's own existing
  // meaning" decision below (the idle-driver flag, and now the per-shift roster colors).
  async function getExistingFillRgbs(zip) {
    const stylesFile = zip.file("xl/styles.xml");
    const existingRgbs = new Set();
    if (!stylesFile) return existingRgbs;
    const xml = await stylesFile.async("string");
    const fillsMatch = /<fills count="\d+">([\s\S]*?)<\/fills>/.exec(xml);
    if (fillsMatch) {
      const rgbRe = /rgb="([0-9A-Fa-f]{8})"/g;
      let m;
      while ((m = rgbRe.exec(fillsMatch[1]))) existingRgbs.add(m[1].toUpperCase());
    }
    return existingRgbs;
  }

  // Picks the first candidate (in order) not already present anywhere in this file's own
  // palette, and not already claimed by an earlier pick in this same patch run (alreadyPicked) --
  // so two different purposes (e.g. two different shifts) never accidentally end up the same
  // color just because both of their first choices happened to collide with the file's palette.
  // Falls back to the first candidate if every one collides (matches this module's existing
  // "reuse the request cleanly rather than error" style -- a rare double-use of one color is far
  // better than failing the whole patch).
  function pickColor(candidates, existingRgbs, alreadyPicked) {
    const pick = candidates.find((c) => !existingRgbs.has(c) && !alreadyPicked.has(c));
    return pick || candidates[0];
  }

  // Candidate fill colors to flag a driver who was available on a given day but had no task
  // left to give them once every task that day was filled. A single hardcoded color is not
  // safe: a real roster's own palette can already use a given color for something else entirely
  // (confirmed directly against a real file whose own template already painted "not scheduled"
  // day cells with this exact magenta, unrelated to this tool) -- reusing it would make the new
  // flag visually indistinguishable from an existing, different meaning already in the file.
  const IDLE_FLAG_ARGB_CANDIDATES = ["FFFF00FF", "FF00FFFF", "FFFF3399", "FF33CCFF", "FF9933FF", "FF00CC99"];

  async function pickIdleFlagColor(zip) {
    const existingRgbs = await getExistingFillRgbs(zip);
    return pickColor(IDLE_FLAG_ARGB_CANDIDATES, existingRgbs, new Set());
  }

  // One candidate-list per shift (Early Morning, Morning, Late Morning, Early Afternoon,
  // Afternoon, Late Afternoon, Early Night, Night, Late Night, matching SHIFT_NAMES order in
  // driver_assignment_engine.js -- nine narrower bands, three per period, replacing the earlier
  // five wide ones). Confirmed scheme: three yellow shades / three orange shades / three blue
  // shades, dark-to-light within each period, each print-friendly enough that the task code text
  // stays readable and the whole roster still reads as one grid. Each list has fallbacks for when
  // a file's own palette already happens to use the first choice (same reasoning as the idle-flag
  // candidates above).
  const SHIFT_FLAG_ARGB_CANDIDATES = [
    ["FFFFC000", "FFE8A33C", "FFBF9000"], // Early Morning -- dark yellow
    ["FFFFD966", "FFFFCC66", "FFF2C55C"], // Morning -- medium yellow
    ["FFFFF2CC", "FFFFE699", "FFFFEB84"], // Late Morning -- light yellow
    ["FFC55A11", "FFB45F06", "FF9C4A0A"], // Early Afternoon -- dark orange
    ["FFED7D31", "FFF4B183", "FFFFA351"], // Afternoon -- orange
    ["FFF8CBAD", "FFFBE0CE", "FFFADBC7"], // Late Afternoon -- light orange/peach
    ["FF2E5F8A", "FF1F4E79", "FF305496"], // Early Night -- dark blue
    ["FF5B9BD5", "FF8FAADC", "FF6FA8DC"], // Night -- medium blue
    ["FFADD8E6", "FFBDD7EE", "FF9DC3E6"], // Late Night -- light blue
  ];

  async function pickShiftColors(zip) {
    const existingRgbs = await getExistingFillRgbs(zip);
    const alreadyPicked = new Set();
    return SHIFT_FLAG_ARGB_CANDIDATES.map((candidates) => {
      const color = pickColor(candidates, existingRgbs, alreadyPicked);
      alreadyPicked.add(color);
      return color;
    });
  }

  // Finds (or, the first time it's needed, appends) a solid-fill cellXf style in xl/styles.xml
  // for the given ARGB color, reusing the real roster's standard day-cell border (borderId="1")
  // and font (fontId="7", matching the existing blank/available-cell style) so a flagged cell
  // still looks like part of the same grid instead of visually breaking the sheet. Idempotent:
  // calling it again (even across separate applyCellPatches runs against a file this already
  // patched) finds the existing fill/xf instead of appending a duplicate.
  async function ensureFillStyle(zip, argbColor) {
    const partName = "xl/styles.xml";
    const stylesFile = zip.file(partName);
    if (!stylesFile) throw new Error("This workbook has no xl/styles.xml part.");
    let xml = await stylesFile.async("string");

    const fillsRe = /<fills count="(\d+)">([\s\S]*?)<\/fills>/;
    const fillsMatch = fillsRe.exec(xml);
    if (!fillsMatch) throw new Error("xl/styles.xml has no <fills> block.");
    const fillsCount = parseInt(fillsMatch[1], 10);
    const fillEntries = fillsMatch[2].match(/<fill>[\s\S]*?<\/fill>/g) || [];

    let fillIndex = fillEntries.findIndex((f) => f.includes(`rgb="${argbColor}"`));
    if (fillIndex === -1) {
      const newFill = `<fill><patternFill patternType="solid"><fgColor rgb="${argbColor}"/><bgColor indexed="64"/></patternFill></fill>`;
      const newFillsBlock = `<fills count="${fillsCount + 1}">${fillsMatch[2]}${newFill}</fills>`;
      xml = xml.slice(0, fillsMatch.index) + newFillsBlock + xml.slice(fillsMatch.index + fillsMatch[0].length);
      fillIndex = fillsCount;
    }

    const cellXfsRe = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/;
    const cellXfsMatch = cellXfsRe.exec(xml);
    if (!cellXfsMatch) throw new Error("xl/styles.xml has no <cellXfs> block.");
    const cellXfsCount = parseInt(cellXfsMatch[1], 10);
    const xfEntries = cellXfsMatch[2].match(/<xf\b[^>]*?\/>|<xf\b[^>]*?>[\s\S]*?<\/xf>/g) || [];

    let xfIndex = xfEntries.findIndex((x) => {
      const fillIdMatch = /\sfillId="(\d+)"/.exec(x);
      const borderIdMatch = /\sborderId="(\d+)"/.exec(x);
      return fillIdMatch && parseInt(fillIdMatch[1], 10) === fillIndex && borderIdMatch && borderIdMatch[1] === "1";
    });
    if (xfIndex === -1) {
      const newXf = `<xf numFmtId="0" fontId="7" fillId="${fillIndex}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`;
      const newCellXfsBlock = `<cellXfs count="${cellXfsCount + 1}">${cellXfsMatch[2]}${newXf}</cellXfs>`;
      xml = xml.slice(0, cellXfsMatch.index) + newCellXfsBlock + xml.slice(cellXfsMatch.index + cellXfsMatch[0].length);
      xfIndex = cellXfsCount;
    }

    zip.file(partName, xml);
    return xfIndex;
  }

  // Replaces (or inserts) just the style index of a cell, leaving its existing content (value,
  // formula, type attribute, everything) completely untouched -- used to flag an idle driver's
  // day cell without altering what's actually written there.
  function patchCellStyleInSheetXml(xml, address, styleIndex) {
    const re = new RegExp(`<c r="${address}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
    const m = re.exec(xml);
    if (!m) return insertCellIntoRow(xml, address, null, ` s="${styleIndex}"`);
    const attrs = /\ss="\d+"/.test(m[1]) ? m[1].replace(/\ss="\d+"/, ` s="${styleIndex}"`) : `${m[1]} s="${styleIndex}"`;
    const newCellXml = `<c r="${address}"${attrs}${m[2]}`;
    return xml.slice(0, m.index) + newCellXml + xml.slice(m.index + m[0].length);
  }

  // Writes both a new value AND a new (explicit) style index for a cell in one go -- used for
  // the per-shift roster coloring, where every patched cell needs its usual value (the task code)
  // plus a fill that shows which shift it belongs to, rather than the existing style it happened
  // to already carry.
  function patchCellValueAndStyleInSheetXml(xml, address, value, styleIndex) {
    const re = new RegExp(`<c r="${address}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
    const m = re.exec(xml);
    const styleAttr = ` s="${styleIndex}"`;
    const newCellXml = buildCellXml(address, styleAttr, value);
    if (!m) return insertCellIntoRow(xml, address, value, styleAttr);
    return xml.slice(0, m.index) + newCellXml + xml.slice(m.index + m[0].length);
  }

  // Reads the existing style index (the `s="N"` attribute) of one cell, or null if the cell
  // either doesn't exist yet or carries no explicit style -- used to clone a real task row's
  // look (font, borders, alignment) onto a brand-new row a supervisor adds by hand, so it reads
  // as part of the same sheet instead of the plain default styling an untouched blank row has.
  async function getCellStyleIndex(zip, sheetIndex, row, col) {
    const sheetParts = await getSheetPartNames(zip);
    const partName = sheetParts[sheetIndex];
    if (!partName) return null;
    const xml = await zip.file(partName).async("string");
    const address = cellAddress(row, col);
    const re = new RegExp(`<c r="${address}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    const m = re.exec(xml);
    if (!m) return null;
    const styleMatch = m[1].match(/\ss="(\d+)"/);
    return styleMatch ? parseInt(styleMatch[1], 10) : null;
  }

  // Resolves ExcelJS-style worksheet order (0-based, matching workbook.worksheets[i]) to the
  // actual xl/worksheets/sheetN.xml part name for each sheet -- via workbook.xml's <sheets>
  // order and xl/_rels/workbook.xml.rels, not by assuming sheet1.xml is always worksheets[0]
  // (usually true, but not guaranteed by the format).
  async function getSheetPartNames(zip) {
    const workbookXml = await zip.file("xl/workbook.xml").async("string");
    const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");

    const relIds = [];
    const sheetRe = /<sheet\b([^>]*)\/>/g;
    let m;
    while ((m = sheetRe.exec(workbookXml))) {
      const ridMatch = m[1].match(/\br:id="([^"]+)"/);
      if (ridMatch) relIds.push(ridMatch[1]);
    }

    const relMap = {};
    const relRe = /<Relationship\b([^>]*)\/>/g;
    while ((m = relRe.exec(relsXml))) {
      const idMatch = m[1].match(/\bId="([^"]+)"/);
      const targetMatch = m[1].match(/\bTarget="([^"]+)"/);
      if (idMatch && targetMatch) relMap[idMatch[1]] = targetMatch[1];
    }

    return relIds.map((rid) => {
      const target = relMap[rid];
      if (!target) throw new Error(`workbook.xml.rels has no relationship for sheet id ${rid}.`);
      return "xl/" + target.replace(/^\.?\//, "");
    });
  }

  // Some Task Program files carry their actual trip-number/Main-Passenger data as floating
  // shapes drawn over the grid (xl/drawings/drawingN.xml) rather than as plain cell values --
  // confirmed directly against a real file: the "Tasks" column only has generic duty codes, but
  // each row also has one or more small text-box shapes reading a real 5-digit trip number,
  // filled bright yellow (srgbClr FFFF00) exactly when that leg is a Passenger assignment
  // (anything else -- white, a theme background color, or no fill -- means Main). This is
  // something ExcelJS's reader doesn't expose at all (it only understands plain images in a
  // drawing part), which is why this needs to go straight at the raw XML like the rest of this
  // module. Returns each sheet's drawing part name, resolved the same way getSheetPartNames()
  // resolves worksheet parts: via each worksheet's own _rels file, not by assuming drawingN.xml
  // lines up with sheet N.
  async function getDrawingPartNames(zip) {
    const sheetParts = await getSheetPartNames(zip);
    const results = [];
    for (const partName of sheetParts) {
      const lastSlash = partName.lastIndexOf("/");
      const relsPath = `${partName.slice(0, lastSlash)}/_rels/${partName.slice(lastSlash + 1)}.rels`;
      const relsFile = zip.file(relsPath);
      if (!relsFile) { results.push(null); continue; }
      const relsXml = await relsFile.async("string");
      const m = /<Relationship\b[^>]*Type="[^"]*\/drawing"[^>]*Target="([^"]+)"/.exec(relsXml);
      if (!m) { results.push(null); continue; }
      // Target is relative to the worksheet part's own directory (e.g. "../drawings/drawing17.xml").
      const base = partName.slice(0, lastSlash);
      const parts = base.split("/").concat(m[1].split("/"));
      const resolved = [];
      parts.forEach((p) => { if (p === "..") resolved.pop(); else if (p !== ".") resolved.push(p); });
      results.push(resolved.join("/"));
    }
    return results;
  }

  // Returns the set of 1-indexed rows on the given sheet that have at least one Passenger-marked
  // (yellow-filled) trip-number shape drawn on them -- a row can carry more than one trip-number
  // shape (a duty made of more than one leg); this only asks "does this row have a Passenger leg
  // at all", which is what the trip-priority preference actually needs to know.
  async function findPassengerMarkedRows(zip, sheetIndex) {
    const drawingParts = await getDrawingPartNames(zip);
    const partName = drawingParts[sheetIndex];
    const rows = new Set();
    if (!partName) return rows;
    const drawingFile = zip.file(partName);
    if (!drawingFile) return rows;
    const xml = await drawingFile.async("string");

    const anchorRe = /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
    let m;
    while ((m = anchorRe.exec(xml))) {
      const block = m[1];
      const rowMatch = /<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(block);
      if (!rowMatch) continue;

      const text = (block.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((t) => t.slice(5, -6)).join("").trim();
      if (!/^\d{5}$/.test(text)) continue; // only real trip-number shapes carry this meaning

      const spPrMatch = /<xdr:spPr\b[^>]*>([\s\S]*?)<\/xdr:spPr>/.exec(block);
      const fillMatch = spPrMatch && /<a:solidFill><a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(spPrMatch[1]);
      const isYellow = !!fillMatch && fillMatch[1].toUpperCase() === "FFFF00";
      if (isYellow) rows.add(parseInt(rowMatch[1], 10) + 1); // xdr:row is 0-indexed; cell rows are 1-indexed
    }
    return rows;
  }

  // patchesBySheetIndex: { [sheetIndex]: [{ row, col, value } | { row, col, flag: true } |
  // { row, col, value, shiftIdx } | { row, col, value, styleIndex }, ...] }
  // A `flag: true` entry is style-only -- it recolors the cell (to whichever candidate color
  // pickIdleFlagColor() finds unused in this specific file) without touching whatever value is
  // already there (used to mark an available-but-unused driver's day cell). A `shiftIdx` entry
  // writes the value AND recolors the cell to that shift's color (0-4, matching SHIFT_NAMES
  // order in driver_assignment_engine.js), so a supervisor can see each day's shift at a glance.
  // A `styleIndex` entry writes the value with that EXACT style index (from getCellStyleIndex()),
  // rather than either preserving whatever style the target cell already had or looking one up by
  // shift/flag -- used to make a brand-new row a supervisor added by hand carry the same
  // font/border/alignment as a real task row elsewhere on the same sheet.
  // Returns a new ArrayBuffer for the patched .xlsx -- every part not named in patchesBySheetIndex
  // (plus xl/styles.xml, only if a flag or shiftIdx patch is actually present) is carried through
  // by JSZip unchanged.
  async function applyCellPatches(originalArrayBuffer, patchesBySheetIndex) {
    const zip = await JSZip.loadAsync(originalArrayBuffer);
    // Real .xlsx files (including every one this engine has been tested against) don't carry
    // explicit directory entries -- a part's path implies its folders, nothing more. Capture the
    // original entry list before any edits, since JSZip's file() silently synthesizes folder
    // placeholder entries (e.g. "xl/", "xl/worksheets/") for any nested path it's asked to set,
    // even when that exact file already existed at that path. Left in, those become a genuine
    // structural difference from the original package -- confirmed as the actual cause of a real
    // "can't open this file" failure, not just a cosmetic one.
    const originalNames = new Set(Object.keys(zip.files));
    const sheetParts = await getSheetPartNames(zip);

    let flagStyleIndex = null;
    async function getFlagStyleIndex() {
      if (flagStyleIndex == null) {
        const color = await pickIdleFlagColor(zip);
        flagStyleIndex = await ensureFillStyle(zip, color);
      }
      return flagStyleIndex;
    }

    let shiftStyleIndexes = null;
    async function getShiftStyleIndex(shiftIdx) {
      if (!shiftStyleIndexes) {
        const colors = await pickShiftColors(zip);
        // Sequential, not Promise.all -- ensureFillStyle reads xl/styles.xml, appends to it, and
        // writes it straight back into the zip. Running all 5 calls concurrently means each one
        // starts from the same stale snapshot and the last write wins, silently discarding the
        // other 4 shifts' fills (confirmed directly: only 1 of 5 shift colors actually made it
        // into a real patched file's styles.xml under Promise.all).
        shiftStyleIndexes = [];
        for (const color of colors) {
          shiftStyleIndexes.push(await ensureFillStyle(zip, color));
        }
      }
      return shiftStyleIndexes[shiftIdx];
    }

    for (const sheetIndexStr of Object.keys(patchesBySheetIndex)) {
      const sheetIndex = parseInt(sheetIndexStr, 10);
      const partName = sheetParts[sheetIndex];
      if (!partName) throw new Error(`No worksheet part found for sheet index ${sheetIndex}.`);
      let xml = await zip.file(partName).async("string");
      for (const patch of patchesBySheetIndex[sheetIndex]) {
        const address = cellAddress(patch.row, patch.col);
        if (patch.flag) {
          const styleIndex = await getFlagStyleIndex();
          xml = patchCellStyleInSheetXml(xml, address, styleIndex);
        } else if (patch.shiftIdx != null) {
          const styleIndex = await getShiftStyleIndex(patch.shiftIdx);
          xml = patchCellValueAndStyleInSheetXml(xml, address, patch.value, styleIndex);
        } else if (patch.styleIndex != null) {
          xml = patchCellValueAndStyleInSheetXml(xml, address, patch.value, patch.styleIndex);
        } else {
          xml = patchCellInSheetXml(xml, address, patch.value);
        }
      }
      zip.file(partName, xml);
    }

    // Deleting straight from the internal map (not zip.remove(), which recursively deletes
    // everything nested under a folder path -- "xl/" is the parent of nearly the whole package,
    // so calling remove() on it would wipe out real content, not just the phantom placeholder).
    for (const name of Object.keys(zip.files)) {
      const entry = zip.files[name];
      if (entry && entry.dir && !originalNames.has(name)) delete zip.files[name];
    }

    return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  }

  // Real TRUE row insertion -- a brand-new row lands at its real chronological position among the
  // existing rows (e.g. a 07:30 reserve next to the real 07:00/08:00 rows), with everything below
  // it shifted down, rather than always appended after the last real row. Confirmed directly
  // against a real file, end to end, before this was written: every row below an insertion point
  // has to shift (cells, formulas, merged cells, conditional-formatting ranges, the sheet's own
  // dimension), AND so does every floating drawing shape anchored to those rows -- both the
  // twoCellAnchor bar graphics AND the oneCellAnchor real-trip-code labels drawn inside a reserve
  // bar (missing the second type was a real bug caught mid-development: those labels were being
  // silently left behind at their old row while the bar around them moved). A shared formula group
  // (Excel's "don't repeat this formula text in every cell" optimization) is converted to plain,
  // independent formulas on every affected cell instead of shifted in place -- its declared `ref`
  // range can't be kept correct once new rows are spliced into the middle of it, and a stale range
  // is exactly the kind of thing that triggers Excel's "this workbook needs repair" recovery flow
  // (confirmed directly: removing this was what actually fixed it, calcChain alone wasn't enough).
  // xl/calcChain.xml (a pure performance-hint index of formula cells, by address) goes stale the
  // same way and is removed outright rather than rewritten -- Excel just recalculates from scratch
  // on open, which is what the OOXML spec says is always safe to do.
  //
  // insertionsBySheetIndex: { [sheetIndex]: [ { beforeRow, rows: [ { cells: { colNum: value } } ] } ] }
  // `beforeRow` is a 1-indexed row number in the ORIGINAL (pre-shift) sheet -- the new row(s) land
  // immediately before whatever real row currently has that number. Multiple insertion points on
  // the same sheet, and multiple rows at the same point, are both supported; `cells` values may be
  // a string, a number (an Excel numeric/time serial -- see minutesToExcelTimeSerial in
  // driver_assignment_engine.js), or omitted for a column that should just carry the template
  // row's own style with no value. Every OTHER column the template row has (its zebra/border
  // styling, and any formula it carries, e.g. a duration calc) is cloned automatically -- the
  // caller only needs to supply the columns it actually has real data for.
  //
  // The "template row" for a given insertion point -- whose full column styling, drawing-shape
  // bar (if any), and formulas get cloned onto its new rows -- is auto-detected as the nearest
  // real row before the insertion point that carries exactly 4 drawing shapes (this file
  // template's own convention for "a plain reserve duty, no real trip picked up during it": two
  // "Madinah" bracket boxes, one connecting line, one "RESERVE" label -- confirmed directly against
  // a real file). Falls back to just the row immediately before the insertion point, with no
  // shape clone, if no such row is found nearby or the sheet has no drawing part at all -- the row
  // itself, its cells, and its styling still insert and shift correctly either way.
  async function applyRowInsertions(originalArrayBuffer, insertionsBySheetIndex) {
    const zip = await JSZip.loadAsync(originalArrayBuffer);
    const originalNames = new Set(Object.keys(zip.files));
    const sheetParts = await getSheetPartNames(zip);
    const drawingParts = await getDrawingPartNames(zip);
    const EMU_PER_PT = 12700;
    const DEFAULT_ROW_HEIGHT_PT = 13.2;
    const GANTT_ROW_HEIGHT_PT = 36.45;
    const CLEAN_BAR_SHAPE_COUNT = 4;

    function uuid() {
      const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
      return `{${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}}`;
    }

    for (const sheetIndexStr of Object.keys(insertionsBySheetIndex)) {
      const sheetIndex = parseInt(sheetIndexStr, 10);
      const insertions = (insertionsBySheetIndex[sheetIndex] || []).filter((ins) => ins.rows && ins.rows.length);
      if (!insertions.length) continue;
      insertions.sort((a, b) => a.beforeRow - b.beforeRow);

      const partName = sheetParts[sheetIndex];
      if (!partName) throw new Error(`No worksheet part found for sheet index ${sheetIndex}.`);
      let sheetXml = await zip.file(partName).async("string");
      const drawingPartName = drawingParts[sheetIndex];
      let drawingXml = drawingPartName ? await zip.file(drawingPartName).async("string") : null;

      function shiftMap(oldRow) {
        let shift = 0;
        for (const ins of insertions) if (oldRow >= ins.beforeRow) shift += ins.rows.length;
        return oldRow + shift;
      }
      insertions.forEach((ins) => { ins.newFirstRow = shiftMap(ins.beforeRow - 1) + 1; });

      // --- Shared-formula master templates: capture BEFORE any edits, keyed by si, as the
      // formula text with the master cell's own row number generalized to a "{R}" placeholder. ---
      const sheetDataMatch = /<sheetData>([\s\S]*?)<\/sheetData>/.exec(sheetXml);
      const sharedFormulaTemplates = {};
      const masterRe = /<f t="shared" ref="[^"]*" si="(\d+)">([^<]*)<\/f>/g;
      let mm;
      while ((mm = masterRe.exec(sheetDataMatch[1]))) {
        const si = mm[1], masterFormula = mm[2];
        const before = sheetDataMatch[1].slice(0, mm.index);
        const ownerMatch = /<c r="[A-Z]+(\d+)"[^>]*>[^<]*$/.exec(before.slice(-60));
        const ownerRow = ownerMatch ? ownerMatch[1] : null;
        sharedFormulaTemplates[si] = ownerRow
          ? masterFormula.replace(new RegExp(`([A-Za-z]+)${ownerRow}(?!\\d)`, "g"), "$1{R}")
          : null;
      }

      // --- Rebuild <sheetData>: remap every row's own number, every cell address within it, any
      // self-referencing formula token (e.g. a VLOOKUP reading its own row's Code cell), and
      // convert any shared-formula cell to an independent plain formula. ---
      const rowChunkRe = /<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
      const oldRows = [];
      let rm;
      while ((rm = rowChunkRe.exec(sheetDataMatch[1]))) oldRows.push({ oldRow: parseInt(rm[1], 10), xml: rm[0] });

      const cellAddrRe = /<c r="([A-Z]+)(\d+)"/g;
      const remappedRows = oldRows.map(({ oldRow, xml }) => {
        const newRow = shiftMap(oldRow);
        let x = xml.replace(new RegExp(`^<row r="${oldRow}"`), `<row r="${newRow}"`);
        x = x.replace(cellAddrRe, (m0, colLetters, rowDigits) => {
          if (parseInt(rowDigits, 10) !== oldRow) return m0;
          return `<c r="${colLetters}${newRow}"`;
        });
        if (newRow !== oldRow) {
          // Self-referencing formulas anywhere in this row (e.g. =VLOOKUP(C53,...) inside D53, or
          // a duration calc like =AF53-F53) need their own row token updated to match, or they'd
          // silently read a different row.
          x = x.replace(new RegExp(`\\b([A-Z]+)${oldRow}\\b`, "g"), (m0, colLetters) => `${colLetters}${newRow}`);
        }
        x = x.replace(/<f t="shared"(?: ref="[^"]*")? si="(\d+)"(?:>[^<]*)?<\/f>|<f t="shared"(?: ref="[^"]*")? si="(\d+)"\/>/g, (m0, si1, si2) => {
          const si = si1 || si2;
          const tmpl = sharedFormulaTemplates[si];
          return tmpl ? `<f>${tmpl.split("{R}").join(newRow)}</f>` : m0;
        });
        return { oldRow, newRow, xml: x };
      });

      // --- Per-insertion template row: nearest earlier row with exactly CLEAN_BAR_SHAPE_COUNT
      // drawing shapes (a plain reserve bar, no real trip legs mixed in) -- falls back to just the
      // row immediately before the insertion point (style-only, no shape clone) if none is found. ---
      let allDrawingAnchors = [];
      const shapeCountByOldRow0 = {};
      if (drawingXml) {
        allDrawingAnchors = drawingXml.match(/<xdr:twoCellAnchor>[\s\S]*?<\/xdr:twoCellAnchor>/g) || [];
        allDrawingAnchors.forEach((a) => {
          const fm = /<xdr:from><xdr:col>\d+<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/.exec(a);
          if (!fm) return;
          const r = parseInt(fm[1], 10);
          shapeCountByOldRow0[r] = (shapeCountByOldRow0[r] || 0) + 1;
        });
      }
      insertions.forEach((ins) => {
        let templateRow1 = null;
        for (let r1 = ins.beforeRow - 1; r1 >= 1; r1--) {
          if (shapeCountByOldRow0[r1 - 1] === CLEAN_BAR_SHAPE_COUNT) { templateRow1 = r1; break; }
        }
        ins.styleTemplateRow1 = templateRow1 || Math.max(1, ins.beforeRow - 1);
        ins.shapeTemplateRow1 = templateRow1; // null -> no bar graphic for this insertion's new rows
      });

      // --- Build the new rows' own XML: full column-style clone from the template row, caller's
      // value overrides on top, any formula the template row carries reproduced with the new row. ---
      function extractRowStyleAndFormulaMap(rowNum) {
        const rowMatch = new RegExp(`<row r="${rowNum}"[^>]*>([\\s\\S]*?)</row>`).exec(sheetDataMatch[1]);
        if (!rowMatch) return {};
        const cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        const map = {};
        let cm;
        while ((cm = cellRe.exec(rowMatch[1]))) {
          const styleMatch = /\ss="(\d+)"/.exec(cm[2]);
          const fMatch = cm[3] && /<f[^>]*>([^<]*)<\/f>/.exec(cm[3]);
          const sharedMatch = cm[3] && /<f t="shared"(?: ref="[^"]*")? si="(\d+)"/.exec(cm[3]);
          let formulaTemplate = null;
          if (sharedMatch) formulaTemplate = sharedFormulaTemplates[sharedMatch[1]] || null;
          else if (fMatch) formulaTemplate = fMatch[1].replace(new RegExp(`([A-Za-z]+)${rowNum}(?!\\d)`, "g"), "$1{R}");
          map[cm[1]] = { style: styleMatch ? styleMatch[1] : null, formulaTemplate };
        }
        return map;
      }

      const newRowXmlByNewRow = {};
      insertions.forEach((ins) => {
        const styleMap = extractRowStyleAndFormulaMap(ins.styleTemplateRow1);
        ins.rows.forEach((rowSpec, i) => {
          const newRow = ins.newFirstRow + i;
          const cols = Object.keys(styleMap).sort((a, b) => colLetterToNumber(a) - colLetterToNumber(b));
          const cellsXml = cols.map((colLetters) => {
            const { style, formulaTemplate } = styleMap[colLetters];
            const colNum = colLetterToNumber(colLetters);
            const addr = `${colLetters}${newRow}`;
            const styleAttr = style != null ? ` s="${style}"` : "";
            const override = rowSpec.cells ? rowSpec.cells[colNum] : undefined;
            if (override !== undefined) {
              if (override == null) return `<c r="${addr}"${styleAttr}/>`;
              if (typeof override === "number") return `<c r="${addr}"${styleAttr}><v>${override}</v></c>`;
              return `<c r="${addr}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(override)}</t></is></c>`;
            }
            if (formulaTemplate) return `<c r="${addr}"${styleAttr}><f>${formulaTemplate.split("{R}").join(newRow)}</f></c>`;
            return `<c r="${addr}"${styleAttr}/>`;
          }).join("");
          newRowXmlByNewRow[newRow] = `<row r="${newRow}" ht="${GANTT_ROW_HEIGHT_PT}" customHeight="1">${cellsXml}</row>`;
        });
      });

      // --- Reassemble <sheetData> in ascending new-row order. ---
      const allRowsByNewRow = {};
      remappedRows.forEach((r) => { allRowsByNewRow[r.newRow] = r.xml; });
      Object.assign(allRowsByNewRow, newRowXmlByNewRow);
      const finalRowNumbers = Object.keys(allRowsByNewRow).map(Number).sort((a, b) => a - b);
      const newSheetDataInner = finalRowNumbers.map((n) => allRowsByNewRow[n]).join("");
      sheetXml = sheetXml.slice(0, sheetDataMatch.index) + `<sheetData>${newSheetDataInner}</sheetData>` + sheetXml.slice(sheetDataMatch.index + sheetDataMatch[0].length);

      // --- Shift merged cells, conditional-formatting ranges, and the sheet's own dimension. ---
      function shiftRef(ref) {
        return ref.replace(/([A-Z]+)(\d+)/g, (m0, col, row) => `${col}${shiftMap(parseInt(row, 10))}`);
      }
      sheetXml = sheetXml.replace(/<mergeCell ref="([^"]+)"\/>/g, (m0, ref) => `<mergeCell ref="${shiftRef(ref)}"/>`);
      sheetXml = sheetXml.replace(/<conditionalFormatting sqref="([^"]+)">/g, (m0, sqref) => {
        const shifted = sqref.split(" ").map(shiftRef).join(" ");
        return `<conditionalFormatting sqref="${shifted}">`;
      });
      const dimMatch = /<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/.exec(sheetXml);
      if (dimMatch) {
        const newDimEnd = shiftMap(parseInt(dimMatch[4], 10));
        sheetXml = sheetXml.replace(dimMatch[0], `<dimension ref="${dimMatch[1]}${dimMatch[2]}:${dimMatch[3]}${newDimEnd}"/>`);
      }
      zip.file(partName, sheetXml);

      // --- Shift every drawing shape (both anchor types) to its new row, recomputing its cached
      // absolute y-offset against the new row-height layout -- old rows keep their own height,
      // newly inserted rows are the tall Gantt-row height. Then clone each insertion's bar
      // template (if one was found) onto its own new rows. ---
      if (drawingXml) {
        const finalHeightByNewRow = {};
        oldRows.forEach(({ oldRow, xml }) => {
          const htMatch = /\sht="([\d.]+)"/.exec(xml);
          finalHeightByNewRow[shiftMap(oldRow)] = htMatch ? parseFloat(htMatch[1]) : DEFAULT_ROW_HEIGHT_PT;
        });
        Object.keys(newRowXmlByNewRow).forEach((n) => { finalHeightByNewRow[n] = GANTT_ROW_HEIGHT_PT; });
        function cumulativeEmuAtTopOfNewRow(newRow1) {
          let pt = 0;
          for (let r = 1; r < newRow1; r++) pt += (finalHeightByNewRow[r] != null ? finalHeightByNewRow[r] : DEFAULT_ROW_HEIGHT_PT);
          return Math.round(pt * EMU_PER_PT);
        }

        const twoCellRe = /<xdr:twoCellAnchor>[\s\S]*?<\/xdr:twoCellAnchor>/g;
        const shiftedTwoCell = allDrawingAnchors.map((shapeXml) => {
          let s = shapeXml;
          const fromMatch = /<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>(\d+)<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row><xdr:rowOff>(\d+)<\/xdr:rowOff><\/xdr:from>/.exec(s);
          const toMatch = /<xdr:to><xdr:col>(\d+)<\/xdr:col><xdr:colOff>(\d+)<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row><xdr:rowOff>(\d+)<\/xdr:rowOff><\/xdr:to>/.exec(s);
          const fromNew0 = shiftMap(parseInt(fromMatch[3], 10) + 1) - 1, toNew0 = shiftMap(parseInt(toMatch[3], 10) + 1) - 1;
          s = s.replace(/(<xdr:from><xdr:col>\d+<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>)\d+(<\/xdr:row>)/, `$1${fromNew0}$2`);
          s = s.replace(/(<xdr:to><xdr:col>\d+<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>)\d+(<\/xdr:row>)/, `$1${toNew0}$2`);
          const newY = cumulativeEmuAtTopOfNewRow(fromNew0 + 1) + parseInt(fromMatch[4], 10);
          s = s.replace(/(<a:off x="\d+" y=")\d+(")/, `$1${newY}$2`);
          return s;
        });
        drawingXml = drawingXml.replace(twoCellRe, () => shiftedTwoCell.shift());

        const oneCellRe = /<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g;
        const allOneCellAnchors = drawingXml.match(oneCellRe) || [];
        const shiftedOneCell = allOneCellAnchors.map((shapeXml) => {
          let s = shapeXml;
          const fromMatch = /<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>(\d+)<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row><xdr:rowOff>(\d+)<\/xdr:rowOff><\/xdr:from>/.exec(s);
          const fromNew0 = shiftMap(parseInt(fromMatch[3], 10) + 1) - 1;
          s = s.replace(/(<xdr:from><xdr:col>\d+<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>)\d+(<\/xdr:row>)/, `$1${fromNew0}$2`);
          const newY = cumulativeEmuAtTopOfNewRow(fromNew0 + 1) + parseInt(fromMatch[4], 10);
          s = s.replace(/(<a:off x="\d+" y=")\d+(")/, `$1${newY}$2`);
          return s;
        });
        drawingXml = drawingXml.replace(oneCellRe, () => shiftedOneCell.shift());

        let maxId = 0, idm;
        const idRe = /<xdr:cNvPr id="(\d+)"/g;
        while ((idm = idRe.exec(drawingXml))) maxId = Math.max(maxId, parseInt(idm[1], 10));
        let nextId = maxId + 1;

        const newBarAnchors = [];
        insertions.forEach((ins) => {
          if (!ins.shapeTemplateRow1) return; // no clean-bar template found nearby -- skip gracefully
          const templateShapes = allDrawingAnchors.filter((a) => {
            const fm = /<xdr:from><xdr:col>\d+<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/.exec(a);
            return fm && parseInt(fm[1], 10) === ins.shapeTemplateRow1 - 1;
          });
          ins.rows.forEach((rowSpec, i) => {
            const newRow1 = ins.newFirstRow + i;
            const targetRow0 = newRow1 - 1;
            const topEmu = cumulativeEmuAtTopOfNewRow(newRow1);
            templateShapes.forEach((shapeXml) => {
              let s = shapeXml;
              s = s.replace(/(<xdr:from><xdr:col>\d+<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>)\d+(<\/xdr:row>)/, `$1${targetRow0}$2`);
              s = s.replace(/(<xdr:to><xdr:col>\d+<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>)\d+(<\/xdr:row>)/, `$1${targetRow0}$2`);
              const idMatch = /<xdr:cNvPr id="(\d+)" name="([^"]*)"/.exec(s);
              const thisId = nextId++;
              s = s.replace(`<xdr:cNvPr id="${idMatch[1]}" name="`, `<xdr:cNvPr id="${thisId}" name="`);
              s = s.replace(/id="\{[0-9A-Fa-f-]+\}"\/>/, `id="${uuid()}"/>`);
              const fromRowOffMatch = /<xdr:from>.*?<xdr:rowOff>(\d+)<\/xdr:rowOff>/.exec(s);
              const newY = topEmu + parseInt(fromRowOffMatch[1], 10);
              s = s.replace(/(<a:off x="\d+" y=")\d+(")/, `$1${newY}$2`);
              newBarAnchors.push(s);
            });
          });
        });
        drawingXml = drawingXml.replace("</xdr:wsDr>", newBarAnchors.join("") + "</xdr:wsDr>");
        zip.file(drawingPartName, drawingXml);
      }
    }

    // calcChain.xml is a pure performance-hint index; once any formula has moved or been added,
    // it's stale, and a stale one is a real trigger for Excel's "needs repair" flow. Only remove
    // it (plus its two references) if it's actually present -- not every workbook has one.
    if (zip.files["xl/calcChain.xml"]) {
      delete zip.files["xl/calcChain.xml"];
      const ctFile = zip.file("[Content_Types].xml");
      if (ctFile) {
        const ct = await ctFile.async("string");
        zip.file("[Content_Types].xml", ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*?\/>/, ""));
      }
      const relsFile = zip.file("xl/_rels/workbook.xml.rels");
      if (relsFile) {
        const rels = await relsFile.async("string");
        zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship[^>]*Target="calcChain\.xml"\/>/, ""));
      }
    }

    for (const name of Object.keys(zip.files)) {
      const entry = zip.files[name];
      if (entry && entry.dir && !originalNames.has(name)) delete zip.files[name];
    }

    return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  }

  return {
    cellAddress, colNumberToLetter, colLetterToNumber, applyCellPatches, getSheetPartNames,
    patchCellInSheetXml, patchCellStyleInSheetXml, patchCellValueAndStyleInSheetXml, ensureFillStyle,
    pickIdleFlagColor, IDLE_FLAG_ARGB_CANDIDATES, pickShiftColors, SHIFT_FLAG_ARGB_CANDIDATES,
    getDrawingPartNames, findPassengerMarkedRows, getCellStyleIndex, applyRowInsertions,
  };
});
