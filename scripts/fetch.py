"""一次データの取得（GitHub Actions 上で実行）。
  1. 令和6年度 DPC導入の影響評価に係る調査「退院患者調査」の集計表（xlsx / pdf）
     ※ 参考資料2 (7)(8)(9) の MDC別ファイル（MDC01〜18）は第2段階のため除外
  2. 医療情報ネット オープンデータ（病院 施設票・定義書）… 開設者情報の照合用
  3. 国土数値情報 医療圏データ（A38）… 市区町村→二次医療圏
出力: RAW_DIR 以下（manifest.json にファイル一覧）
"""
import json, re, sys, time, pathlib, urllib.parse
import requests
from bs4 import BeautifulSoup

RAW = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "raw")
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0 (dpc-taiin-dashboard data pipeline)"
DPC_TOP = "https://www.mhlw.go.jp/stf/shingi2/newpage_00203.html"
NAVII_TOP = "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/newpage_43373.html"
manifest = []

def get(url):
    for i in range(4):
        try:
            r = S.get(url, timeout=300); r.raise_for_status(); return r
        except Exception as e:
            print("retry", url, e, flush=True); time.sleep(5 * (i + 1))
    raise RuntimeError(url)

def links(url):
    r = get(url); r.encoding = r.apparent_encoding
    soup = BeautifulSoup(r.text, "html.parser"); res, h = [], ""
    for el in soup.find_all(["h1", "h2", "h3", "h4", "h5", "a"]):
        if el.name != "a":
            h = el.get_text(" ", strip=True); continue
        if el.get("href"):
            res.append({"heading": h, "text": el.get_text(" ", strip=True),
                        "href": urllib.parse.urljoin(url, el["href"])})
    return res

def safe(s): return re.sub(r"[\\/:*?\"<>|\s［］\[\]（）()]+", "_", s).strip("_")

def save(sub, name, url, meta):
    p = RAW / sub / name
    p.parent.mkdir(parents=True, exist_ok=True)
    c = get(url).content; p.write_bytes(c)
    manifest.append({"path": str(p.relative_to(RAW)), "bytes": len(c), "url": url, **meta})
    print("saved", p, len(c), flush=True)

def fetch_dpc():
    seen = set()
    for l in links(DPC_TOP):
        href = l["href"]
        if not re.search(r"\.(xlsx?|pdf)$", href, re.I) or href in seen: continue
        if re.search(r"MDC\s*\d{2}", l["text"]): continue  # 第2段階
        seen.add(href)
        fn = href.rsplit("/", 1)[-1]
        name = f"{safe(l['heading'])[:20]}__{safe(l['text'])[:60]}__{fn}"
        save("dpc", name, href, {"heading": l["heading"], "text": l["text"]})

def fetch_navii():
    L = links(NAVII_TOP)
    hosp = [l for l in L if re.search(r"hospital_facility_info_\d{8}\.csv\.zip$", l["href"])]
    if hosp:
        latest = max(hosp, key=lambda l: re.search(r"(\d{8})", l["href"]).group(1))
        save("navii", latest["href"].rsplit("/", 1)[-1], latest["href"], {"text": latest["text"]})
    for l in L:
        if "定義書" in l["text"] and re.search(r"\.xlsx?$", l["href"]):
            save("navii", "definition__" + l["href"].rsplit("/", 1)[-1], l["href"], {"text": l["text"]})

def fetch_geo():
    save("geo", "A38-20_GML.zip", "https://nlftp.mlit.go.jp/ksj/gml/data/A38/A38-20/A38-20_GML.zip", {})

if __name__ == "__main__":
    errs = []
    for f in (fetch_dpc, fetch_navii, fetch_geo):
        try: f()
        except Exception as e:
            print("FAILED", f.__name__, e, flush=True); errs.append(f"{f.__name__}: {e}")
    (RAW / "manifest.json").write_text(json.dumps({"files": manifest, "errors": errs}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(manifest)} files, {len(errs)} errors")
