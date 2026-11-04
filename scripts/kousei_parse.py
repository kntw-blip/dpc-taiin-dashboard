"""地方厚生局「コード内容別医療機関一覧表」（医科 Excel）から病院を抽出する。
usage: python kousei_parse.py KOUSEI_DIR OUT_CSV
  KOUSEI_DIR: fetch.py が保存した raw/kousei（zip / xlsx が局ごとのフォルダに入っている）
出力列: pref, code, name, address, owner, manager, beds_total, beds, kinds, src
"""
import csv, io, re, sys, zipfile, pathlib, unicodedata
from python_calamine import CalamineWorkbook

PREFS = "北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄".split()
ROMA = {"hokkaido": "北海道", "fukui": "福井", "shiga": "滋賀", "kyoto": "京都", "osaka": "大阪", "hyogo": "兵庫", "nara": "奈良",
        "wakayama": "和歌山", "fukuoka": "福岡", "saga": "佐賀", "nagasaki": "長崎", "kumamoto": "熊本", "ooita": "大分", "oita": "大分",
        "miyazaki": "宮崎", "kagoshima": "鹿児島", "okinawa": "沖縄", "kagawa": "香川", "tokushima": "徳島", "ehime": "愛媛", "kochi": "高知", "kouchi": "高知"}

def nk(s): return unicodedata.normalize("NFKC", str(s or "")).strip()

def pref_of(label):
    """ファイル名・シート名から都道府県を推定"""
    s = re.sub(r"#U([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), label)
    for p in sorted(PREFS, key=len, reverse=True):
        if p in s: return p
    low = s.lower()
    for k, p in ROMA.items():
        if re.search(rf"(^|[_/\-.]){k}([_/\-.]|$)", low): return p
    m = re.search(r"(?:^|/)(\d{2})\d(?:#U|[^\d])", s)   # 関東信越: 131… = 東京
    if m and 1 <= int(m.group(1)) <= 47: return PREFS[int(m.group(1)) - 1]
    return None

def iter_books(root):
    for p in sorted(root.rglob("*")):
        if p.suffix.lower() == ".xlsx":
            yield str(p.relative_to(root)), p.read_bytes()
        elif p.suffix.lower() == ".zip":
            z = zipfile.ZipFile(p)
            for info in z.infolist():
                nm = info.filename
                if not (info.flag_bits & 0x800):
                    try: nm = nm.encode("cp437").decode("cp932")
                    except Exception: pass
                nm = nm.replace("\\", "/")
                if nm.lower().endswith(".xlsx"):
                    yield f"{p.relative_to(root)}::{nm}", z.read(info)

def skip_file(label):
    s = re.sub(r"#U([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), label)
    return bool(re.search(r"歯科|薬局|sika|shika|yakkyoku|haishi|jitai|torikeshi|診療科目変更|shitei-touhoku-r\d", s))

def parse_rows(rows, pref, src):
    recs, cur = [], None
    def close():
        if cur: recs.append(cur)
    for r in rows:
        r = [nk(x) for x in r] + [""] * 12
        digits = re.sub(r"\D", "", r[1])
        if re.fullmatch(r"\d+(\.0)?", r[0]) and len(digits) == 7 and not r[1].startswith("("):
            close()
            cur = {"pref": pref, "code": digits, "name": r[2], "address": r[3], "owner": r[5],
                   "manager": r[6], "beds": [r[8]] if r[8] else [], "kinds": [r[9]] if r[9] else [], "src": src}
        elif cur:
            if r[8]: cur["beds"].append(r[8])
            if r[9]: cur["kinds"].append(r[9])
            # 名称・開設者の折り返し（次行に続く場合）
            if r[2] and not r[1]: cur["name"] += r[2]
            if r[5] and not re.match(r"^[\d(]", r[5]): cur["owner"] += r[5]
    close()
    return recs

def beds_total(lines):
    t, parts = 0, []
    for l in lines:
        m = re.match(r"^(一般|療養|精神|結核|感染)(\d+)$", re.sub(r"[\s,]", "", l))
        if m: t += int(m.group(2)); parts.append(f"{m.group(1)}{m.group(2)}")
    return t, " ".join(parts)

def main(root, out):
    root = pathlib.Path(root); allrecs = []
    for label, data in iter_books(root):
        if skip_file(label): continue
        wb = CalamineWorkbook.from_filelike(io.BytesIO(data))
        for s in wb.sheet_names:
            pref = pref_of(s) or pref_of(label)
            if not pref:
                print("NO PREF", label, s); continue
            recs = parse_rows(wb.get_sheet_by_name(s).to_python(skip_empty_area=False), pref, label)
            allrecs += recs
    seen, rows = set(), []
    for r in allrecs:
        key = (r["pref"], r["code"])
        if key in seen: continue
        seen.add(key)
        bt, bd = beds_total(r["beds"])
        kinds = " ".join(k for k in r["kinds"] if not re.match(r"^(現存|休止)$", k))
        if not (bt >= 20 or "病院" in kinds or "地域支援" in kinds or "特定機能" in kinds): continue
        rows.append({"pref": r["pref"], "code": r["code"], "name": r["name"], "address": r["address"], "owner": r["owner"],
                     "manager": r["manager"], "beds_total": bt, "beds": bd, "kinds": kinds, "src": r["src"]})
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    import collections
    print(len(rows), "hospitals"); print(sorted(collections.Counter(r["pref"] for r in rows).items(), key=lambda x: PREFS.index(x[0])))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
