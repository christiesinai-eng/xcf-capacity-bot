"""Reads named tabs out of an exported workbook (.xlsx) without any third-party library.

    python3 -I scripts/xlsx-tabs.py <book.xlsx> <out.json> Tab1 Key2=Tab2 ...

Writes {"Tab1": {"values": [[...header...], [...row...], ...]}, "Key2": {...}}. A "Key=Tab" argument stores the
tab under another name (for example Requests=Glean_Requests, which is how the compare scripts expect it).
Empty trailing rows are dropped. Formula cells give their computed value; TRUE/FALSE come out as 'TRUE'/'FALSE'.

How to get the workbook: the Drive connector's download_file_content with exportMimeType
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet saves a huge JSON result to a file; then
    jq -r .content <that file> | base64 -d > book.xlsx
"""
import sys, json, zipfile, re
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

if len(sys.argv) < 4:
    print(__doc__)
    sys.exit(1)

z = zipfile.ZipFile(sys.argv[1])
ss = []
if 'xl/sharedStrings.xml' in z.namelist():
    for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
        ss.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
wbx = ET.fromstring(z.read('xl/workbook.xml'))
rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
sheets = {s.get('name'): rels[s.get('{%s}id' % NS['r'])] for s in wbx.find('m:sheets', NS)}


def col(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def read(name):
    t = sheets[name].lstrip('/')
    t = t if t.startswith('xl/') else 'xl/' + t
    rows = []
    for row in ET.fromstring(z.read(t)).iter('{%s}row' % NS['m']):
        cells = {}
        for c in row.findall('m:c', NS):
            ty = c.get('t')
            v = c.find('m:v', NS)
            val = ''
            if ty == 's' and v is not None:
                val = ss[int(v.text)]
            elif ty == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
            elif ty == 'b' and v is not None:
                val = 'TRUE' if v.text == '1' else 'FALSE'
            elif v is not None and v.text is not None:
                val = v.text if ty in ('str', 'e') else (int(float(v.text)) if float(v.text).is_integer() else float(v.text))
            cells[col(c.get('r'))] = val
        w = max(cells) + 1 if cells else 0
        rows.append([cells.get(i, '') for i in range(w)])
    while rows and not any(str(c).strip() for c in rows[-1]):
        rows.pop()
    return rows


want = dict((a.split('=')[0], a.split('=')[-1]) for a in sys.argv[3:])
out = {}
for key, tab in want.items():
    if tab not in sheets:
        print(key, 'MISSING; tabs are:', sorted(sheets))
        continue
    out[key] = {'values': read(tab)}
    print(key, len(out[key]['values']) - 1, 'data rows')
json.dump(out, open(sys.argv[2], 'w'))
