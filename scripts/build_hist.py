"""経年推移データ（令和元年度〜令和6年度）を作る
usage: python build_hist.py RAW HIST OUT
  RAW  : 令和6年度の一次データ（raw ブランチ。dpc/, geo/）
  HIST : 過去年度の一次データ（raw-hist ブランチ。R1/〜R5/）
  OUT  : site/data

方針（2026-11-12 確認済み）
  - 令和元〜5年度は各年度の報告書の値（4月〜翌3月）、令和6年度は令和6年度の報告書の値（6月〜翌5月）。
  - 告示番号は年度ごとに付け直されるため、各年度の施設概要表の「通番」（前年度の告示番号）をたどって令和6年度の病院につなぐ。
  - 比較対象は令和6年度の顔ぶれで固定。令和6年度までに閉院・統合などで消えた病院は、医療圏×年度の合計としてだけ持つ。
  - 在院日数の指標・患者構成の指標は各年度の報告書の値（その年度の全国平均に対する値）。
"""
import collections, glob, json, pathlib, re, sys, unicodedata
from python_calamine import CalamineWorkbook
from dbfread import DBF

RAW, HIST, OUT = map(pathlib.Path, sys.argv[1:4])
YEARS = ["R1", "R2", "R3", "R4", "R5", "R6"]
YLAB = ["令和元年度", "令和2年度", "令和3年度", "令和4年度", "令和5年度", "令和6年度"]
PREFS = "北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄".split()
AKITA = {"北秋田": "県北", "大館・鹿角": "県北", "能代・山本": "県北", "秋田周辺": "県央", "由利本荘・にかほ": "県央",
         "大仙・仙北": "県南", "横手": "県南", "湯沢・雄勝": "県南"}
ALIAS = {"40305": "40231", "04423": "04216", "22138": "22131", "22139": "22135", "22140": "22137"}
log = []

def nk(s): return unicodedata.normalize("NFKC", str(s if s is not None else "")).strip()
def kid(v):
    k = nk(v).split(".")[0]
    return k if re.fullmatch(r"\d{5}", k) else None
def num(v, nd=None):
    if isinstance(v, (int, float)): x = float(v)
    else:
        try: x = float(nk(v).replace(",", ""))
        except ValueError: return None
    return round(x, nd) if nd is not None else x

def book(y, key):
    if y == "R6":
        fs = [f for f in glob.glob(str(RAW / "dpc" / "*.xlsx")) if key in pathlib.Path(f).name]
    else:  # ファイル名は「見出し__リンク文字列__元ファイル名」。リンク文字列で探す
        fs = [f for f in glob.glob(str(HIST / y / "*.xlsx")) if pathlib.Path(f).name.split("__")[1].startswith(key)]
    if len(fs) != 1: raise RuntimeError(f"{y} {key}: {fs}")
    return CalamineWorkbook.from_path(fs[0])
def rows(y, key, sheet=None):
    wb = book(y, key)
    return wb.get_sheet_by_name(sheet or wb.sheet_names[0]).to_python(skip_empty_area=False)
def by_id(rs): return {kid(r[0]): r for r in rs if kid(r[0])}

# ---------- 施設概要表と通番 ----------
# 年度の途中で合併した病院は、同じ告示番号が2行ある（合併前の主たる病院の行＝通番あり、合併後の行＝通番「-」）。
# 2行は「通番」の欄（sub）で区別し、値は合算する（combine）。
FAC = {}
for y in YEARS:
    d = {}
    for r in rows(y, "施設概要表", "施設概要表"):
        k = kid(r[0])
        if not k: continue
        t = nk(r[5])
        row = {"sub": kid(r[1]) or nk(r[1]), "prev": kid(r[1]), "muni": nk(r[2]).split(".")[0].zfill(5), "pref": nk(r[3]), "name": nk(r[4]),
               "type": "DPC" if "DPC参加" in t else "準備" if "準備" in t else "出来高",
               "beds": num(r[15] if y == "R6" else r[14]), "months": num(r[16] if y == "R6" else r[15])}
        if k in d:  # 合併：通番は通番のある行、名称・病床などは合併後の行
            d[k]["rows"].append(row); d[k]["prev"] = d[k]["prev"] or row["prev"]
            d[k].update({x: row[x] for x in ("name", "type", "beds", "muni", "pref")}); d[k]["merged"] = True
        else:
            d[k] = dict(row, rows=[row])
    FAC[y] = d
    log.append(f"{y} facilities {len(d)}, in-year merged {[k for k, v in d.items() if v.get('merged')]}")

# 令和6年度の告示番号 → 各年度の告示番号
LINK = {"R6": {k: k for k in FAC["R6"]}}
for i in range(5, 0, -1):
    y, p = YEARS[i], YEARS[i - 1]
    LINK[p] = {}
    for k6, kc in LINK[y].items():
        v = FAC[y].get(kc)
        if v and v["prev"] and v["prev"] in FAC[p]: LINK[p][k6] = v["prev"]
    log.append(f"linked to {p}: {len(LINK[p])}")

# ---------- 年度ごとの値 ----------

COUNT = ("n", "tot", "surg", "ga")          # 件数：合算
BY_N = ("los", "eff", "cmi", "amb", "unp", "emg", "ref")  # 平均・率：件数で重み付け
BY_MONTH = ("ambm", "emgm", "refm")       # 1カ月当たり：提出月数で重み付け
def combine(parts):
    if len(parts) == 1: return {k: v for k, v in parts[0].items() if k != "months"}
    out = {}
    for key in COUNT:
        vs = [p.get(key) for p in parts if p.get(key) is not None]; out[key] = sum(vs) if vs else None
    for key in BY_N:
        ws = [(p.get(key), p.get("n") or 0) for p in parts if p.get(key) is not None]
        W = sum(w for _, w in ws); out[key] = sum(v * w for v, w in ws) / W if W else None
    for key in BY_MONTH:
        ws = [(p.get(key), p.get("months") or 0) for p in parts if p.get(key) is not None]
        W = sum(w for _, w in ws); out[key] = sum(v * w for v, w in ws) / W if W else None
    return out

KEYS = ["n", "los", "eff", "cmi", "amb", "ambm", "unp", "emg", "emgm", "ref", "refm", "tot", "surg", "ga", "beds"]
ND = {"n": 0, "los": 2, "eff": 4, "cmi": 4, "amb": 4, "ambm": 1, "unp": 4, "emg": 4, "emgm": 1, "ref": 4, "refm": 1, "tot": 0, "surg": 0, "ga": 0, "beds": 0}
VAL = {}   # VAL[y][その年度の告示番号][通番の欄] = {key: value}
MDCN = {}  # MDCN[y][その年度の告示番号] = [18件数]
def by_sub(rs):
    d = collections.defaultdict(dict)
    for r in rs:
        k = kid(r[0])
        if k: d[k][kid(r[1]) or nk(r[1])] = r
    return d
for y in YEARS:
    V = collections.defaultdict(lambda: collections.defaultdict(dict))
    six = y == "R6"
    def put(key, rs, col):
        for k, subs in by_sub(rs).items():
            for sub, r in subs.items(): V[k][sub][key] = num(r[col])
    r = rows(y, "２_在院日数の状況" if six else "３_在院日数の状況", "在院日数の状況")
    put("n", r, 11 if six else 35); put("los", r, 12 if six else 36)
    r = rows(y, "１３_在院日数の平均の差_MDC" if six else "１４_在院日数の平均の差_MDC別", f"R0{y[1]}全体")
    put("cmi", r, 6); put("eff", r, 8)
    r = rows(y, "４_救急車" if six else "５_救急車による搬送の有無")
    put("amb", r, 4 if six else 7); put("ambm", r, 6 if six else 12)
    r = rows(y, "５_救急医療入院" if six else "６_救急医療入院")
    put("unp", r, 4 if six else 7); put("emg", r, 6 if six else 12); put("emgm", r, 10 if six else 22)
    r = rows(y, "６_他院" if six else "７_他院")
    put("ref", r, 4 if six else 7); put("refm", r, 6 if six else 12)
    r = rows(y, "１４_手術化学" if six else "１５_手術", "高度医療")
    put("tot", r, 3); put("surg", r, 4); put("ga", r, 9)
    VAL[y] = {}
    for k, f in FAC[y].items():
        parts = []
        for fr in f["rows"]:
            v = dict(V.get(k, {}).get(fr["sub"], {})); v["months"] = fr["months"]; parts.append(v)
        VAL[y][k] = combine(parts); VAL[y][k]["beds"] = f["beds"]
    m = {}
    for k, subs in by_sub(rows(y, "１１_施設別MDC" if six else "１２_施設別MDC比率", "施設別MDC別比率")).items():
        acc = None
        for r in subs.values():
            tot = num(r[22])
            if not tot: continue
            v = [None if num(x) is None else round(num(x) * tot) for x in r[3:21]]
            acc = v if acc is None else [None if a is None and b is None else (a or 0) + (b or 0) for a, b in zip(acc, v)]
        if acc: m[k] = acc
    MDCN[y] = m

def rnd(key, v):
    if v is None: return None
    return int(round(v)) if ND[key] == 0 else round(v, ND[key])

H = {}
for k6 in FAC["R6"]:
    ser = []
    for key in KEYS:
        ser.append([rnd(key, VAL[y].get(LINK[y].get(k6), {}).get(key)) if LINK[y].get(k6) else None for y in YEARS])
    H[k6] = ser

# ---------- 閉院・統合などで令和6年度にない病院（医療圏×年度の合計） ----------
muni_area = {}
for r in DBF(str(RAW / "geo" / "A38-20_1.dbf"), encoding="cp932"):
    p = PREFS[int(r["A38a_001"][:2]) - 1]; a = r["A38a_004"]
    if p == "秋田": a = AKITA.get(a, a)
    muni_area[r["A38a_001"]] = f"{p}|{a}"
CLOSED = {}
nc = collections.Counter()
for i, y in enumerate(YEARS[:-1]):
    alive = set(LINK[y].values())
    for k, f in FAC[y].items():
        if k in alive: continue
        area = muni_area.get(ALIAS.get(f["muni"], f["muni"]))
        if not area: log.append(f"closed no area {y} {k} {f['name']}"); continue
        nc[y] += 1
        a = CLOSED.setdefault(area, {})
        for sc in (["d", "a"] if f["type"] != "出来高" else ["a"]):
            b = a.setdefault(sc, {"h": [0] * 6, "n": [0] * 6, "m": [[0] * 18 for _ in range(6)]})
            b["h"][i] += 1
            b["n"][i] += int(VAL[y].get(k, {}).get("n") or 0)
            for j, v in enumerate(MDCN[y].get(k) or [None] * 18): b["m"][i][j] += v or 0
            b.setdefault("names", [[] for _ in range(6)])[i].append(f["name"])
log.append(f"closed {dict(nc)}")

# ---------- 合併・分割（各年度の「合併分割医療機関の取扱い」） ----------
EVENTS = collections.defaultdict(list)
for i, y in enumerate(YEARS):
    wb = book(y, "施設概要表")
    if "合併分割医療機関の取扱い" not in wb.sheet_names: continue
    cur = None
    for r in wb.get_sheet_by_name("合併分割医療機関の取扱い").to_python(skip_empty_area=False)[2:]:
        if nk(r[0]) and nk(r[1]):
            cur = {"y": i, "date": nk(r[0])[:10], "kind": nk(r[1]), "before": [], "after": [], "ids": []}
            EVENTS["_"].append(cur)
        if not cur: continue
        if nk(r[4]): cur["before"].append(nk(r[4]))
        if nk(r[7]): cur["after"].append(nk(r[7]))
        if kid(r[5]): cur["ids"].append(kid(r[5]))
ev_by = collections.defaultdict(list)
for e in EVENTS["_"]:
    y = YEARS[e["y"]]
    inv = {v: k for k, v in LINK[y].items()}
    for k in e["ids"]:
        if k in inv: ev_by[inv[k]].append({k2: e[k2] for k2 in ("y", "date", "kind", "before", "after")})
log.append(f"merge/split events {len(EVENTS['_'])}, linked {len(ev_by)}")

OUT.mkdir(parents=True, exist_ok=True)
meta = {"years": YLAB, "keys": KEYS, "linked": {YLAB[i]: len(LINK[y]) for i, y in enumerate(YEARS)},
        "closed_n": {YLAB[i]: nc.get(y, 0) for i, y in enumerate(YEARS)}}
def dump(name, obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    (OUT / name).write_text(s, encoding="utf-8"); log.append(f"{name} {len(s) / 1e6:.2f}MB")
dump("trend.json", {"meta": meta, "h": H, "closed": CLOSED, "events": ev_by})
dump("trend_mdc.json", {"h": {k6: [MDCN[y].get(LINK[y].get(k6)) if LINK[y].get(k6) else None for y in YEARS] for k6 in FAC["R6"]}})
print("\n".join(log))
