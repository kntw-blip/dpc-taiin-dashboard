"""一次データの取得（GitHub Actions 上で実行）。
  1. 令和6年度 DPC導入の影響評価に係る調査「退院患者調査」の集計表（xlsx / pdf）
     ※ 参考資料2 (7) 疾患別手術別集計のMDC別ファイルは dpc_surg/ に保存。(8)(9) 処置のMDC別ファイルは対象外
  2. 医療情報ネット オープンデータ（病院 施設票・定義書）… 開設者情報の照合用
  3. 地方厚生局 コード内容別医療機関一覧表（医科 Excel）… 開設者（法人）の照合用
  4. 国土数値情報 医療圏データ（A38）… 市区町村→二次医療圏
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
    seen, sec = set(), ""
    for l in links(DPC_TOP):
        href, txt = l["href"], l["text"]
        if not re.search(r"\.(xlsx?|pdf)$", href, re.I) or href in seen: continue
        # 直前の (n) 見出し付きリンクで、どの集計に属するMDC別ファイルかを判定
        if "疾患別手術別集計" in txt: sec = "surg"
        elif re.search(r"処置|レジメン|診断群分類毎", txt): sec = ""
        m = re.search(r"MDC\s*(\d{2})", txt)
        if m:
            # 「(7) 疾患別手術別集計」のMDC別ファイルのみ取得（処置1・処置2のMDC別ファイルは対象外）
            if sec == "surg" and "処置" not in txt:
                seen.add(href)
                save("dpc_surg", f"surg_MDC{m.group(1)}__{href.rsplit('/', 1)[-1]}", href, {"heading": l["heading"], "text": txt})
            continue
        seen.add(href)
        fn = href.rsplit("/", 1)[-1]
        name = f"{safe(l['heading'])[:20]}__{safe(txt)[:60]}__{fn}"
        save("dpc", name, href, {"heading": l["heading"], "text": txt})

def fetch_navii():
    L = links(NAVII_TOP)
    hosp = [l for l in L if re.search(r"hospital_facility_info_\d{8}\.csv\.zip$", l["href"])]
    if hosp:
        latest = max(hosp, key=lambda l: re.search(r"(\d{8})", l["href"]).group(1))
        save("navii", latest["href"].rsplit("/", 1)[-1], latest["href"], {"text": latest["text"]})
    for l in L:
        if "定義書" in l["text"] and re.search(r"\.xlsx?$", l["href"]):
            save("navii", "definition__" + l["href"].rsplit("/", 1)[-1], l["href"], {"text": l["text"]})

KOUSEI = {  # 地方厚生局「コード内容別医療機関一覧表」（開設者氏名を含む）
    "hokkaido": "https://kouseikyoku.mhlw.go.jp/hokkaido/gyomu/gyomu/hoken_kikan/code_ichiran.html",
    "tohoku": "https://kouseikyoku.mhlw.go.jp/tohoku/gyomu/gyomu/hoken_kikan/itiran.html",
    "kantoshinetsu": "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/chousa/shitei.html",
    "tokaihokuriku": "https://kouseikyoku.mhlw.go.jp/tokaihokuriku/newpage_00287.html",
    "kinki": "https://kouseikyoku.mhlw.go.jp/kinki/tyousa/shinkishitei.html",
    "chugokushikoku": "https://kouseikyoku.mhlw.go.jp/chugokushikoku/chousaka/iryoukikanshitei.html",
    "shikoku": "https://kouseikyoku.mhlw.go.jp/shikoku/gyomu/gyomu/hoken_kikan/shitei/index.html",
    "kyushu": "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/index_00006.html",
}

def fetch_kouseikyoku():
    for k, url in KOUSEI.items():
        try:
            L = links(url)
        except Exception as e:
            print("FAILED page", k, e, flush=True); continue
        got = 0
        for l in L:
            href, txt, h = l["href"], l["text"], l["heading"]
            if not re.search(r"\.(zip|xlsx?)$", href, re.I): continue
            if re.search(r"新規|廃止|辞退|取消|訪問看護|施術所|届出受理", h + txt): continue
            if re.search(r"歯科|薬局", txt) and "医科" not in txt: continue
            if k == "kyushu" and got >= 8: break  # 最新月のみ（8事務所）
            fn = href.rsplit("/", 1)[-1]
            try:
                save(f"kousei/{k}", fn, href, {"heading": h, "text": txt}); got += 1
            except Exception as e:
                print("FAILED file", k, href, e, flush=True)
        print("kousei", k, got, flush=True)

def fetch_geo():
    save("geo", "A38-20_GML.zip", "https://nlftp.mlit.go.jp/ksj/gml/data/A38/A38-20/A38-20_GML.zip", {})

if __name__ == "__main__":
    errs = []
    for f in (fetch_dpc, fetch_navii, fetch_kouseikyoku, fetch_geo):
        try: f()
        except Exception as e:
            print("FAILED", f.__name__, e, flush=True); errs.append(f"{f.__name__}: {e}")
    (RAW / "manifest.json").write_text(json.dumps({"files": manifest, "errors": errs}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(manifest)} files, {len(errs)} errors")
