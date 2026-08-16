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
  // (if any) but always writing the new value as a self-contained inline string -- this avoids
  // ever touching xl/sharedStrings.xml, which is the whole point: one less part this module
  // needs to understand or keep consistent.
  function buildCellXml(address, styleAttr, value) {
    if (value == null || value === "") return `<c r="${address}"${styleAttr}/>`;
    return `<c r="${address}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }

  // Inserts a cell that has no existing <c> element at all (a genuinely untouched, unstyled
  // cell) into its row at the correct ascending-column position -- a fallback for completeness;
  // every cell this engine actually targets in practice already exists (even blank ones) because
  // real spreadsheets apply borders/fills to whole ranges, which forces the cell element to
  // exist even when empty.
  function insertCellIntoRow(xml, address, value, styleAttr) {
    const addrMatch = /^([A-Z]+)(\d+)$/.exec(address);
    const colLetters = addrMatch[1];
    const rowNum = addrMatch[2];
    const targetCol = colLetterToNumber(colLetters);

    const rowRe = new RegExp(`<row r="${rowNum}"([^>]*)>([\\s\\S]*?)</row>`);
    const rowMatch = rowRe.exec(xml);
    if (!rowMatch) {
      throw new Error(`Row ${rowNum} has no <row> element in this sheet -- cannot place a new cell at ${address}.`);
    }
    const rowAttrs = rowMatch[1];
    const rowInner = rowMatch[2];

    const cellRe = /<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
    let insertPos = rowInner.length;
    let cm;
    while ((cm = cellRe.exec(rowInner))) {
      if (colLetterToNumber(cm[1]) > targetCol) { insertPos = cm.index; break; }
    }
    const newCellXml = buildCellXml(address, styleAttr || "", value);
    const newRowInner = rowInner.slice(0, insertPos) + newCellXml + rowInner.slice(insertPos);
    const newRow = `<row r="${rowNum}"${rowAttrs}>${newRowInner}</row>`;
    return xml.slice(0, rowMatch.index) + newRow + xml.slice(rowMatch.index + rowMatch[0].length);
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

  // Fill color used to flag a driver who was available on a given day but had no task left to
  // give them once every task that day was filled -- chosen to be visually distinct from every
  // fill color already present in the real roster's palette (checked directly against its
  // xl/styles.xml: reds, oranges, yellows, greens and purples are already in use for other
  // statuses, this bright magenta is not).
  const IDLE_FLAG_ARGB = "FFFF00FF";

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

  // patchesBySheetIndex: { [sheetIndex]: [{ row, col, value } | { row, col, flag: true }, ...] }
  // A `flag: true` entry is style-only -- it recolors the cell to IDLE_FLAG_ARGB without touching
  // whatever value is already there (used to mark an available-but-unused driver's day cell).
  // Returns a new ArrayBuffer for the patched .xlsx -- every part not named in patchesBySheetIndex
  // (plus xl/styles.xml, only if a flag patch is actually present) is carried through by JSZip
  // unchanged.
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
      if (flagStyleIndex == null) flagStyleIndex = await ensureFillStyle(zip, IDLE_FLAG_ARGB);
      return flagStyleIndex;
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

  return {
    cellAddress, colNumberToLetter, colLetterToNumber, applyCellPatches, getSheetPartNames,
    patchCellInSheetXml, patchCellStyleInSheetXml, ensureFillStyle, IDLE_FLAG_ARGB,
  };
});
