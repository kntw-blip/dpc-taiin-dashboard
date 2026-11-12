"""疾患別（DPC6桁）の集計表を令和元年度〜令和6年度分取得し、縦長のCSV（gzip）に変換する（GitHub Actions 上で実行）
usage: python fetch_dis.py OUT_DIR
  対象：参考資料2「疾患別手術別集計_MDCxx」「疾患別手術有無別処置1有無別集計_MDCxx」
  Excelは1年度で100MBを超えるため、そのままは保存せず、病院×列見出し×値の縦長CSVにして保存する。
  出力：OUT/<年度>/<表>_MDCxx.csv.gz（列：告示番号, 通番, 見出し1|見出し2|..., 値）
        値は数値。秘匿（「-」、10件未満）のセルは出力しない（元の表に空欄はなく、数値か「-」だけ）。
"""
import csv, gzip, io, json, re, sys, time, pathlib, unicodedata, urllib.parse
import requests
from bs4 import BeautifulSoup
from python_calamine import CalamineWorkbook

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "dis")
PAGES = {
    "R6": "https://www.mhlw.go.jp/stf/shingi2/newpage_00203.html",
    "R5": "https://www.mhlw.go.jp/stf/shingi2/newpage_00137.html",
    "R4": "https://www.mhlw.go.jp/stf/shingi2/newpage_39119.html",
    "R3": "https://www.mhlw.go.jp/stf/shingi2/0000196043_00006.html",
    "R2": "https://www.mhlw.go.jp/stf/shingi2/0000196043_00005.html",
    "R1": "https://www.mhlw.go.jp/stf/shingi2/0000196043_00004.html",
}
TABLES = {"surg": r"疾患別手術別集計_?MDC\s*(\d{2})", "op1": r"疾患別手術有無別処置1有無別集計_?MDC\s*(\d{2})"}
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0 (dpc-taiin-dashboard data pipeline)"
nk = lambda s: unicodedata.normalize("NFKC", str(s if s is not None else "")).strip()
def kid(v):
    k = nk(v).split(".")[0]
    return k if re.fullmatch(r"\d{5}", k) else None
def get(url):
    for i in range(4):
        try:
            r = S.get(url, timeout=300); r.raise_for_status(); return r
        except Exception as e:
            print("retry", url, e, flush=True); time.sleep(5 * (i + 1))
    raise RuntimeError(url)

def to_long(content, w):
    wb = CalamineWorkbook.from_filelike(io.BytesIO(content)); n = 0; hdr_out = None
    for sh in wb.sheet_names:
        rows = wb.get_sheet_by_name(sh).to_python(skip_empty_area=False)
        first = next((i for i, r in enumerate(rows) if r and kid(r[0])), None)
        if first is None: continue
        heads = []
        for r in rows[:first]:
            cur, fill = "", []
            for c in r:
                cur = nk(c).replace("\n", "") or cur; fill.append(cur)
            heads.append(fill)
        hdr_out = [h[:12] for h in heads]
        for r in rows[first:]:
            k = kid(r[0])
            if not k: continue
            sub = kid(r[1]) or nk(r[1])
            for j in range(3, len(r)):
                v = nk(r[j])
                if v in ("", "-"): continue   # 表は数値か「-」（10件未満の秘匿）だけ。出力しないセル＝秘匿
                path = "|".join(h[j] if j < len(h) else "" for h in heads)
                w.writerow([k, sub, path, v]); n += 1
    return n, hdr_out

manifest, errors = [], []
for y, url in PAGES.items():
    try:
        r = get(url); r.encoding = r.apparent_encoding
        soup = BeautifulSoup(r.text, "html.parser")
        links = [(nk(a.get_text(" ", strip=True)), urllib.parse.urljoin(url, a["href"])) for a in soup.find_all("a", href=True)]
        (OUT / y).mkdir(parents=True, exist_ok=True)
        for tname, pat in TABLES.items():
            hits = [(re.search(pat, t).group(1), h) for t, h in links if re.search(pat, t) and re.search(r"\.xlsx?$", h, re.I)]
            print(y, tname, len(hits), "files", flush=True)
            for mdc, href in hits:
                c = get(href).content
                fn = OUT / y / f"{tname}_MDC{mdc}.csv.gz"
                with gzip.open(fn, "wt", encoding="utf-8", newline="") as g:
                    w = csv.writer(g); n, hdr = to_long(c, w)
                manifest.append({"year": y, "table": tname, "mdc": mdc, "url": href, "xlsx_bytes": len(c), "cells": n, "header_sample": hdr})
                print("saved", fn, n, flush=True)
    except Exception as e:
        print("FAILED", y, e, flush=True); errors.append(f"{y}: {e}")
(OUT / "manifest.json").write_text(json.dumps({"files": manifest, "errors": errors}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(manifest)} files, {len(errors)} errors")
