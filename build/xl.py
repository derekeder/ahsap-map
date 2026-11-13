import openpyxl, csv, sys
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
for ws in wb.worksheets:
    rows = [r for r in ws.iter_rows(values_only=True) if any(c is not None for c in r)]
    print("SHEET", ws.title, len(rows), "rows")
    for r in rows[:6]: print(r)
    out = sys.argv[2] + ("" if len(wb.worksheets)==1 else "_"+ws.title) + ".csv"
    with open(out,"w",newline="") as f: csv.writer(f).writerows(rows)
    print("wrote", out)
