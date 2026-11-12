"""過去年度（令和元年度〜令和5年度）の退院患者調査の集計表を取得（GitHub Actions 上で実行）
usage: python fetch_hist.py OUT_DIR
  - 推移に使う表だけを取得（施設概要・在院日数・救急車・救急医療入院・紹介・施設別MDC・在院日数の平均の差・手術等）
  - 各ページのリンク一覧を links_<年度>.json に保存（取りこぼし確認用）
"""
import json, re, sys, time, pathlib, urllib.parse
import requests
from bs4 import BeautifulSoup

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "hist")
PAGES = {
    "R5": "https://www.mhlw.go.jp/stf/shingi2/newpage_00137.html",
    "R4": "https://www.mhlw.go.jp/stf/shingi2/newpage_39119.html",
    "R3": "https://www.mhlw.go.jp/stf/shingi2/0000196043_00006.html",
    "R2": "https://www.mhlw.go.jp/stf/shingi2/0000196043_00005.html",
    "R1": "https://www.mhlw.go.jp/stf/shingi2/0000196043_00004.html",
}
# 取得する表（リンク文字列に含まれるキーワード）
WANT = [r"施設概要", r"在院日数の状況", r"救急車", r"救急医療入院", r"他院より紹介|紹介の有無|紹介", r"施設別MDC|MDC別比率|医療機関別MDC",
        r"在院日数の平均の差", r"手術.*化学療法|化学療法.*放射線|高度医療", r"分析対象外"]
SKIP = r"MDC\s*\d{2}|処置|疾患別手術別|診断群分類毎|医療圏別|予定・救急|入院から24時間|重症度|FIM|SOFA|再入院|後発|退院時転帰|入院経路|退院先"

S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0 (dpc-taiin-dashboard data pipeline)"
manifest, errors = [], []

def get(url):
    for i in range(4):
        try:
            r = S.get(url, timeout=300); r.raise_for_status(); return r
        except Exception as e:
            print("retry", url, e, flush=True); time.sleep(5 * (i + 1))
    raise RuntimeError(url)

def safe(s): return re.sub(r"[\\/:*?\"<>|\s［］\[\]（）()]+", "_", s).strip("_")

for y, url in PAGES.items():
    try:
        r = get(url); r.encoding = r.apparent_encoding
        soup = BeautifulSoup(r.text, "html.parser"); links, h = [], ""
        for e in soup.find_all(["h2", "h3", "h4", "a"]):
            if e.name != "a": h = e.get_text(" ", strip=True); continue
            if e.get("href"): links.append({"heading": h, "text": e.get_text(" ", strip=True), "href": urllib.parse.urljoin(url, e["href"])})
        (OUT / y).mkdir(parents=True, exist_ok=True)
        (OUT / f"links_{y}.json").write_text(json.dumps(links, ensure_ascii=False, indent=1), encoding="utf-8")
        seen = set()
        for l in links:
            href, txt = l["href"], l["text"]
            if not re.search(r"\.xlsx?$", href, re.I) or href in seen: continue
            if re.search(SKIP, txt) or not any(re.search(w, txt) for w in WANT): continue
            seen.add(href)
            name = f"{safe(l['heading'])[:20]}__{safe(txt)[:60]}__{href.rsplit('/', 1)[-1]}"
            c = get(href).content; (OUT / y / name).write_bytes(c)
            manifest.append({"year": y, "path": f"{y}/{name}", "bytes": len(c), "url": href, "text": txt})
            print("saved", y, name, len(c), flush=True)
    except Exception as e:
        print("FAILED", y, e, flush=True); errors.append(f"{y}: {e}")

(OUT / "manifest.json").write_text(json.dumps({"files": manifest, "errors": errors}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(manifest)} files, {len(errors)} errors")
