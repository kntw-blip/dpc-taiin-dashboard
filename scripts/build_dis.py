"""疾患別（DPC6桁）の手術あり／なしの件数と平均在院日数の推移（令和元年度〜令和6年度）を作る
usage: python build_dis.py RAW HIST DIS OUT
  RAW : 令和6年度の一次データ（raw ブランチ。dpc/ の施設概要表）
  HIST: 過去年度の一次データ（raw-hist ブランチ。R1〜R5 の施設概要表）
  DIS : 疾患別の集計表（raw-dis ブランチ。<年度>/surg_MDCxx.csv.gz, op1_MDCxx.csv.gz, type_*.xlsx）
  OUT : site/data（dis/index.json と dis/<疾患コード>.json を書き出す）

方針（2026-11-13 確認済み）
  - 「手術あり」は厚労省の「疾患別手術有無別処置1有無別集計」と同じ定義：輸血関連手技（K920・K920-2・K923）だけの症例は「手術なし」。
    この表にある疾患はこの表を使う。ない疾患は「疾患別手術別集計」から、手術なし＝99＋(97−97輸血以外の再掲)、手術あり＝それ以外＋97輸血以外の再掲 として求める。
  - 10件未満で秘匿のセルは推計する：全国の施設類型別の合計（DPC参加・準備・出来高算定の3区分）から公表セルの合計を引き、
    残りを同じ区分の秘匿セルの数で割った値（0〜9に収める）を各秘匿セルに入れる。あわせて、最小（秘匿＝0）〜最大（秘匿＝9）の幅も持つ。
  - 年度をまたぐ病院のつなぎ方・年度途中の合併の扱い・閉院等の病院の扱いは経年推移（build_hist.py）と同じ。
  - 平均在院日数は公表されているセルだけの加重平均（秘匿セルの在院日数は不明）。
"""
import collections, csv, glob, gzip, json, pathlib, re, sys, unicodedata
from python_calamine import CalamineWorkbook
from dbfread import DBF

RAW, HIST, DIS, OUT = map(pathlib.Path, sys.argv[1:5])
YEARS = ["R1", "R2", "R3", "R4", "R5", "R6"]
YLAB = ["令和元年度", "令和2年度", "令和3年度", "令和4年度", "令和5年度", "令和6年度"]
BUCKETS = ["D", "P", "F"]   # DPC参加・DPC準備・出来高算定
PREFS = "北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄".split()
AKITA = {"北秋田": "県北", "大館・鹿角": "県北", "能代・山本": "県北", "秋田周辺": "県央", "由利本荘・にかほ": "県央",
         "大仙・仙北": "県南", "横手": "県南", "湯沢・雄勝": "県南"}
ALIAS = {"40305": "40231", "04423": "04216", "22138": "22131", "22139": "22135", "22140": "22137"}
log = []

def nk(s): return unicodedata.normalize("NFKC", str(s if s is not None else "")).strip()
def kid(v):
    k = nk(v).split(".")[0]
    return k if re.fullmatch(r"\d{5}", k) else None
def num(v):
    if isinstance(v, (int, float)): return float(v)
    try: return float(nk(v).replace(",", ""))
    except ValueError: return None

# ---------- 施設概要表と通番（build_hist.py と同じ） ----------
def fac_rows(y):
    if y == "R6": fs = [f for f in glob.glob(str(RAW / "dpc" / "*.xlsx")) if "施設概要表" in pathlib.Path(f).name]
    else: fs = [f for f in glob.glob(str(HIST / y / "*.xlsx")) if pathlib.Path(f).name.split("__")[1].startswith("施設概要表")]
    return CalamineWorkbook.from_path(fs[0]).get_sheet_by_name("施設概要表").to_python(skip_empty_area=False)
FAC = {}
for y in YEARS:
    d = {}
    for r in fac_rows(y):
        k = kid(r[0])
        if not k: continue
        t = nk(r[5]); b = "D" if "DPC参加" in t else "P" if "準備" in t else "F"
        prev = kid(r[1])
        if k in d:
            d[k]["prev"] = d[k]["prev"] or prev; d[k].update(b=b, muni=nk(r[2]).split(".")[0].zfill(5), name=nk(r[4]))
        else: d[k] = {"prev": prev, "b": b, "muni": nk(r[2]).split(".")[0].zfill(5), "pref": nk(r[3]), "name": nk(r[4])}
    FAC[y] = d
LINK = {"R6": {k: k for k in FAC["R6"]}}
for i in range(5, 0, -1):
    y, p = YEARS[i], YEARS[i - 1]; LINK[p] = {}
    for k6, kc in LINK[y].items():
        v = FAC[y].get(kc)
        if v and v["prev"] and v["prev"] in FAC[p]: LINK[p][k6] = v["prev"]
INV = {y: {v: k for k, v in LINK[y].items()} for y in YEARS}   # その年度の告示番号 → 令和6年度の告示番号
muni_area = {}
for r in DBF(str(RAW / "geo" / "A38-20_1.dbf"), encoding="cp932"):
    p = PREFS[int(r["A38a_001"][:2]) - 1]; a = r["A38a_004"]
    if p == "秋田": a = AKITA.get(a, a)
    muni_area[r["A38a_001"]] = f"{p}|{a}"

# ---------- 全国の施設類型別の合計 ----------
TYPE_COLS = [("D", 5), ("D", 7), ("D", 9), ("P", 11), ("F", 13)]   # 大学病院本院群・DPC特定・DPC標準 → D、準備 → P、出来高 → F（件数の列）
def type_totals(y, name):
    """{(code, cellkey): {bucket: 件数}}。cellkey は op1:「手術あり」「手術なし」、surg:「99」「97」…"""
    f = DIS / y / f"{name}.xlsx"
    if not f.exists(): return None
    rows = CalamineWorkbook.from_path(str(f)); rows = rows.get_sheet_by_name(rows.sheet_names[0]).to_python(skip_empty_area=False)
    hdr = [nk(c) for c in rows[0]]
    cols = [(("D" if any(x in h for x in ("大学", "特定", "標準")) else "P" if "準備" in h else "F"), i) for i, h in enumerate(hdr) if re.search(r"大学|特定|標準|準備|出来高", h)]
    out = collections.defaultdict(lambda: collections.defaultdict(float)); code = kind = surg = None
    for r in rows[1:]:
        c = [nk(x) for x in r]
        if re.fullmatch(r"[0-9x]{6}", c[0] or ""): code = c[0]
        if c[2]: kind = c[2]
        if c[3]: surg = c[3]
        if kind != "件数" or not code: continue
        key = surg if name != "type_surg" else c[3] or surg
        for b, i in cols:
            v = num(r[i]) if i < len(r) else None
            if v is not None: out[(code, key)][b] += v
    return out

# ---------- 病院別の公表値 ----------
def load_cells(y, table):
    """{code: {その年度の告示番号: {cellkey: (件数, 在院日数)}}}, names{code: 疾患名}, mdc{code}
    年度途中の合併（同じ告示番号が2行）は、件数は合計、在院日数は件数で重み付け"""
    raw = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(dict))); names = {}; mdc = {}
    for f in sorted(glob.glob(str(DIS / y / f"{table}_MDC*.csv.gz"))):
        m = re.search(r"MDC(\d\d)", f).group(1)
        for k, sub, path, v in csv.reader(gzip.open(f, "rt", encoding="utf-8")):
            p = path.split("|"); code = p[0]; names[code] = p[1]; mdc[code] = m
            raw[code][k][("|".join(p[3:]))][(sub, p[2])] = float(v)
    cells = {}
    for code, hs in raw.items():
        cells[code] = {}
        for k, cs in hs.items():
            d = {}
            for key, vals in cs.items():
                subs = {s for s, _ in vals}
                ns = {s: vals.get((s, "件数")) for s in subs}
                n = sum(v for v in ns.values() if v is not None) if any(v is not None for v in ns.values()) else None
                ls = [(ns[s], vals[(s, "在院日数")]) for s in subs if (s, "在院日数") in vals and ns[s]]
                W = sum(x for x, _ in ls)
                d[key] = (n, sum(x * l for x, l in ls) / W if W else None)
            cells[code][k] = d
    return cells, names, mdc

def clip(x): return max(0.0, min(9.0, x))

INDEX = {"years": YLAB, "codes": {}, "types": {}}
for k6 in FAC["R6"]:
    INDEX["types"][k6] = "".join(FAC[y][LINK[y][k6]]["b"] if LINK[y].get(k6) else "-" for y in YEARS)
PER_CODE = collections.defaultdict(lambda: {"h": collections.defaultdict(lambda: [None] * 6), "inv": [None] * 6,
                                             "closed": collections.defaultdict(lambda: {"d": [[0, 0] for _ in range(6)], "a": [[0, 0] for _ in range(6)]}),
                                             "names": [None] * 6, "src": [""] * 6, "nat": [None] * 6})
check = []
for yi, y in enumerate(YEARS):
    op1, n1, m1 = load_cells(y, "op1"); sg, n2, m2 = load_cells(y, "surg")
    # 令和6年度の「処置1有無別_施設類型別」のリンク先は処置2の表になっている（厚労省の掲載）。手術あり／なしの合計は処置1・2で同じ定義なので、
    # 処置の区分を足し合わせて使う。表にない疾患は「手術別_施設類型別」から 99＋97−97再掲／それ以外 で求める。
    t_op = type_totals(y, "type_op1"); t_sg = type_totals(y, "type_surg")
    def op_total(code, g, b):
        v = t_op.get((code, "手術なし" if g == "n" else "手術あり"))
        if v is not None: return v.get(b, 0)
        cs = {key: d.get(b, 0) for (cc, key), d in t_sg.items() if cc == code}
        if not cs: return None
        r = next((x for x in cs if "再掲" in x), None); r97 = cs.get(r, 0) if r else 0
        if g == "n": return cs.get("99", 0) + cs.get("97", 0) - r97
        return r97 + sum(v for x, v in cs.items() if x not in ("99", "97", r))
    hosp = FAC[y]
    for code in sorted(set(n1) | set(n2)):
        src = "o" if code in n1 else "s"
        H = (op1 if src == "o" else sg)[code]
        if src == "o":
            groups = {"n": [c for c in ("手術なし|処置1あり", "手術なし|処置1なし")], "a": [c for c in ("手術あり|処置1あり", "手術あり|処置1なし")]}
            cellkeys = groups["n"] + groups["a"]
            tot = {g: {b: op_total(code, g, b) for b in BUCKETS} for g in ("n", "a")}
            # 推計：手術あり・なしごとに、区分別の（全国合計−公表合計）÷秘匿セル数
            e = {}
            for g, ck in groups.items():
                for b in BUCKETS:
                    P = sum((H.get(k, {}).get(c) or (0,))[0] or 0 for k in hosp if hosp[k]["b"] == b for c in ck)
                    K = sum(1 for k in hosp if hosp[k]["b"] == b for c in ck if (H.get(k, {}).get(c) or (None,))[0] is None)
                    T = tot[g][b]
                    e[(g, b)] = clip((T - P) / K) if (T is not None and K) else 0.0
                    if T is not None: check.append((y, code, g, b, T, P, K, e[(g, b)]))
            def calc(k):
                b = hosp[k]["b"]; d = H.get(k, {}); out = []
                for g in ("n", "a"):
                    pub = sum(d[c][0] for c in groups[g] if c in d and d[c][0] is not None)
                    ks = sum(1 for c in groups[g] if not (c in d and d[c][0] is not None))
                    los = [(d[c][0], d[c][1]) for c in groups[g] if c in d and d[c][0] and d[c][1] is not None]
                    W = sum(n for n, _ in los)
                    out.append((pub + ks * e[(g, b)], pub, pub + 9 * ks, sum(n * l for n, l in los) / W if W else None))
                return out
            inv = [[2 * e[("n", b)], 18, 2 * e[("a", b)], 18] for b in BUCKETS]
        else:
            cats = sorted({c for k in H for c in H[k]} | ({key for (cc, key) in t_sg if cc == code} if t_sg else set()))
            cats = [c for c in cats if c]
            R97 = next((c for c in cats if "再掲" in c), None)
            e = {}
            for c in cats:
                for b in BUCKETS:
                    P = sum((H.get(k, {}).get(c) or (0,))[0] or 0 for k in hosp if hosp[k]["b"] == b)
                    K = sum(1 for k in hosp if hosp[k]["b"] == b and (H.get(k, {}).get(c) or (None,))[0] is None)
                    T = t_sg.get((code, c), {}).get(b) if t_sg else None
                    e[(c, b)] = clip((T - P) / K) if (T is not None and K) else 0.0
            def cell(d, c, b):
                v = (d.get(c) or (None,))[0]
                return (v, v, v) if v is not None else (e[(c, b)], 0.0, 9.0)
            def derive(d, b):
                g = {c: cell(d, c, b) for c in cats}
                z = (0.0, 0.0, 0.0)
                c99, c97, c97r = g.get("99", z), g.get("97", z), g.get(R97, z) if R97 else z
                r_est = min(c97r[0], c97[0])
                n = (c99[0] + c97[0] - r_est, c99[1] + max(0, c97[1] - c97r[2]), c99[2] + max(0, c97[2] - c97r[1]))
                others = [g[c] for c in cats if c not in ("99", "97", R97)]
                a = (r_est + sum(o[0] for o in others), c97r[1] + sum(o[1] for o in others), min(c97r[2], c97[2]) + sum(o[2] for o in others))
                return n, a
            def calc(k):
                b = hosp[k]["b"]; d = H.get(k, {}); n, a = derive(d, b)
                lo_n = [d["99"]] if "99" in d and d["99"][0] and d["99"][1] is not None else []
                lo_a = [d[c] for c in cats if c not in ("99", "97") and c in d and d[c][0] and d[c][1] is not None]
                f = lambda L: (sum(x * l for x, l in L) / sum(x for x, _ in L)) if L else None
                return [(n[0], n[1], n[2], f(lo_n)), (a[0], a[1], a[2], f(lo_a))]
            inv = []
            for b in BUCKETS:
                n, a = derive({}, b); inv.append([n[0], n[2], a[0], a[2]])
        PC = PER_CODE[code]; PC["names"][yi] = (n1 if src == "o" else n2)[code]; PC["src"][yi] = src
        PC["mdc"] = (m1 if src == "o" else m2)[code]
        PC["inv"][yi] = [[round(x, 2) for x in v] for v in inv]
        natN = natA = 0.0
        for k in hosp:
            (nE, nL, nH, nLos), (aE, aL, aH, aLos) = calc(k)
            natN += nE; natA += aE
            if k not in H: continue   # 公表セルがない病院は inv（区分別の推計値）で表す
            row = [round(nE, 1), nL, nH, round(aE, 1), aL, aH, None if nLos is None else round(nLos, 1), None if aLos is None else round(aLos, 1)]
            k6 = INV[y].get(k)
            if k6: PC["h"][k6][yi] = row
            else:   # 令和6年度にない病院 → 医療圏×年度の合計
                area = muni_area.get(ALIAS.get(hosp[k]["muni"], hosp[k]["muni"]))
                if area:
                    for sc in (["d", "a"] if hosp[k]["b"] != "F" else ["a"]):
                        PC["closed"][area][sc][yi][0] += nE; PC["closed"][area][sc][yi][1] += aE
        PC["nat"][yi] = [round(natN), round(natA)]

# ---------- 書き出し ----------
D = OUT / "dis"; D.mkdir(parents=True, exist_ok=True)
for f in D.glob("*.json"): f.unlink()
total = 0
for code, PC in PER_CODE.items():
    closed = {a: {sc: [[round(x, 1) for x in v] for v in vv] for sc, vv in d.items()} for a, d in PC["closed"].items()
              if any(x for v in d["a"] for x in v)}
    obj = {"code": code, "names": PC["names"], "src": PC["src"], "inv": PC["inv"], "h": dict(PC["h"]), "closed": closed}
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":")); (D / f"{code}.json").write_text(s, encoding="utf-8"); total += len(s)
    INDEX["codes"][code] = {"names": PC["names"], "mdc": PC["mdc"], "src": PC["src"], "nat": PC["nat"], "nh": len(PC["h"])}
(D / "index.json").write_text(json.dumps(INDEX, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
neg = [c for c in check if c[4] - c[5] < -0.5]
over = [c for c in check if c[6] and (c[4] - c[5]) / c[6] > 9]
log.append(f"codes {len(PER_CODE)}, files {total / 1e6:.1f}MB, calibration cells {len(check)}, residual<0: {len(neg)}, residual/K>9: {len(over)}")
(OUT / "dis_check.json").write_text(json.dumps({"neg": neg[:50], "over": over[:50]}, ensure_ascii=False), encoding="utf-8")
print("\n".join(log))
