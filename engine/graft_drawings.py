"""
Grafts the floating Gantt-chart shapes (drawingN.xml) from the ORIGINAL tasks.xlsx onto a
rebuilt workbook that lost them (openpyxl silently drops this kind of drawing content on
save, and it stays lost through a LibreOffice recalc too, since it was never there for
LibreOffice to preserve). Run this as the LAST step, after build.py + recalc.py.

Matches sheets by NAME (not by internal file number), so it's robust even if sheet
ordering/internal numbering ever differs between the two files.
"""
import re
import shutil
import zipfile
import xml.etree.ElementTree as ET

ORIG = "/root/.claude/uploads/2cfc6bdb-220a-5258-a43c-090f63c66610/d8a61241-tasks.xlsx"
DELIVERED = "/tmp/claude-0/-home-user-3ray-d/2cfc6bdb-220a-5258-a43c-090f63c66610/scratchpad/tasks_auto_assign.xlsx"
OUT = DELIVERED  # overwrite in place

NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"
NS_PKGREL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def sheet_name_to_file(zf):
    """Map worksheet name -> internal 'worksheets/sheetN.xml' path, via workbook.xml + its rels."""
    wb_xml = zf.read("xl/workbook.xml")
    wb_rels = zf.read("xl/_rels/workbook.xml.rels")

    ET.register_namespace("", NS_MAIN)
    wb_root = ET.fromstring(wb_xml)
    rels_root = ET.fromstring(wb_rels)

    rid_to_target = {}
    for rel in rels_root:
        rid_to_target[rel.get("Id")] = rel.get("Target")

    name_to_file = {}
    sheets_el = wb_root.find(f"{{{NS_MAIN}}}sheets")
    for sheet_el in sheets_el:
        name = sheet_el.get("name")
        rid = sheet_el.get(f"{{{NS_R}}}id")
        target = rid_to_target.get(rid)
        if target:
            target = target.replace("\\", "/")
            if not target.startswith("worksheets/"):
                target = "worksheets/" + target.split("/")[-1]
            name_to_file[name] = "xl/" + target
    return name_to_file


def sheet_drawing_target(zf, sheet_path):
    """Given 'xl/worksheets/sheetN.xml', find its drawing target from sheetN.xml.rels, if any."""
    parts = sheet_path.split("/")
    rels_path = "/".join(parts[:-1]) + "/_rels/" + parts[-1] + ".rels"
    if rels_path not in zf.namelist():
        return None
    root = ET.fromstring(zf.read(rels_path))
    for rel in root:
        if rel.get("Type", "").endswith("/drawing"):
            target = rel.get("Target")
            # target is relative to xl/worksheets/, e.g. "../drawings/drawing1.xml"
            return "xl/" + target.replace("../", "").lstrip("/")
    return None


def main():
    with zipfile.ZipFile(ORIG) as orig_zf:
        orig_name_to_file = sheet_name_to_file(orig_zf)
        orig_media = {n: orig_zf.read(n) for n in orig_zf.namelist() if n.startswith("xl/media/")}

        # figure out which drawing (+ its rels + referenced media) belongs to each day-tab name
        day_names = [n for n in orig_name_to_file if n.strip().startswith("TEST")]
        drawing_for_name = {}
        for name in day_names:
            sheet_path = orig_name_to_file[name]
            drawing_path = sheet_drawing_target(orig_zf, sheet_path)
            if drawing_path:
                drawing_for_name[name] = drawing_path

        drawing_xml = {p: orig_zf.read(p) for p in set(drawing_for_name.values())}
        drawing_rels = {}
        drawing_media_refs = {}
        for p in drawing_xml:
            rels_path = p.rsplit("/", 1)[0] + "/_rels/" + p.rsplit("/", 1)[1] + ".rels"
            if rels_path in orig_zf.namelist():
                drawing_rels[p] = orig_zf.read(rels_path)
                root = ET.fromstring(drawing_rels[p])
                for rel in root:
                    target = rel.get("Target")
                    if "media" in target:
                        media_path = "xl/" + target.replace("../", "")
                        drawing_media_refs.setdefault(p, []).append(media_path)

    print(f"Found drawings for {len(drawing_for_name)} day tabs: {list(drawing_for_name.keys())}")

    with zipfile.ZipFile(DELIVERED) as deliv_zf:
        deliv_name_to_file = sheet_name_to_file(deliv_zf)
        existing_names = set(deliv_zf.namelist())
        all_entries = {n: deliv_zf.read(n) for n in deliv_zf.namelist()}

    new_entries = dict(all_entries)  # working copy we'll mutate then write out

    added_content_type_overrides = []
    for name, drawing_path in drawing_for_name.items():
        if name not in deliv_name_to_file:
            print(f"  SKIP {name}: not found in delivered workbook")
            continue
        sheet_path = deliv_name_to_file[name]  # e.g. xl/worksheets/sheet1.xml

        # 1. add the drawing xml part itself (if not already added from a shared reference)
        if drawing_path not in new_entries:
            new_entries[drawing_path] = drawing_xml[drawing_path]

        # 2. add the drawing's own rels (image references) + the media files themselves
        if drawing_path in drawing_rels:
            rels_target_path = drawing_path.rsplit("/", 1)[0] + "/_rels/" + drawing_path.rsplit("/", 1)[1] + ".rels"
            new_entries[rels_target_path] = drawing_rels[drawing_path]
            for media_path in drawing_media_refs.get(drawing_path, []):
                if media_path not in new_entries and media_path in orig_media:
                    new_entries[media_path] = orig_media[media_path]

        # 3. add/update this sheet's own rels file with a relationship to the drawing
        sheet_rels_path = sheet_path.rsplit("/", 1)[0] + "/_rels/" + sheet_path.rsplit("/", 1)[1] + ".rels"
        drawing_rel_target = "../" + drawing_path.split("xl/", 1)[1]
        if sheet_rels_path in new_entries:
            root = ET.fromstring(new_entries[sheet_rels_path])
            existing_ids = {rel.get("Id") for rel in root}
            new_id = "rId1"
            i = 1
            while new_id in existing_ids:
                i += 1
                new_id = f"rId{i}"
            rel_el = ET.SubElement(root, f"{{{NS_PKGREL}}}Relationship")
            rel_el.set("Id", new_id)
            rel_el.set("Type", f"{NS_R}/drawing")
            rel_el.set("Target", drawing_rel_target)
            new_entries[sheet_rels_path] = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
        else:
            new_id = "rId1"
            rels_xml = (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                f'<Relationships xmlns="{NS_PKGREL}">'
                f'<Relationship Id="{new_id}" Type="{NS_R}/drawing" Target="{drawing_rel_target}"/>'
                "</Relationships>"
            ).encode("utf-8")
            new_entries[sheet_rels_path] = rels_xml

        # 4. insert <drawing r:id="..."/> into the sheet xml, right before </worksheet>
        sheet_xml = new_entries[sheet_path].decode("utf-8")
        if "<drawing " not in sheet_xml:
            drawing_tag = f'<drawing xmlns:r="{NS_R}" r:id="{new_id}"/>'
            assert sheet_xml.rstrip().endswith("</worksheet>"), f"unexpected tail in {sheet_path}"
            sheet_xml = sheet_xml.replace("</worksheet>", drawing_tag + "</worksheet>")
            new_entries[sheet_path] = sheet_xml.encode("utf-8")

        added_content_type_overrides.append(drawing_path)

    # 5. add Content_Types overrides for the drawing parts
    ct_path = "[Content_Types].xml"
    ct_xml = new_entries[ct_path].decode("utf-8")
    for drawing_path in set(added_content_type_overrides):
        part_name = "/" + drawing_path
        if part_name not in ct_xml:
            override = (
                f'<Override PartName="{part_name}" '
                'ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
            )
            ct_xml = ct_xml.replace("</Types>", override + "</Types>")
    new_entries[ct_path] = ct_xml.encode("utf-8")

    # write everything out to a fresh zip
    tmp_out = OUT + ".tmp"
    with zipfile.ZipFile(tmp_out, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in new_entries.items():
            zf.writestr(name, data)
    shutil.move(tmp_out, OUT)
    print("done ->", OUT)


if __name__ == "__main__":
    main()
