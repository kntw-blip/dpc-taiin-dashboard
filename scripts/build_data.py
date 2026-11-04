"""退院患者調査（令和6年度）の集計表 → サイト用JSON
usage: python build_data.py RAW_DIR MATCH_CSV OVERRIDE_CSV OUT_DIR
  RAW_DIR      : fetch.py の出力（dpc/ geo/ を含む）
  MATCH_CSV    : match_owner.py の出力（施設 ↔ 開設者）
  OVERRIDE_CSV : data/owner_override.csv（手修正。kokuji,corp_name,note）
出力:
  core.json  … 病院ごとの主要指標（列指向: cols + rows）
  mdc.json   … 病院ごとのMDC別詳細
  areas.json … 二次医療圏（患者住所地ベースのMDC別患者数）・全国平均等
  owner_review.csv … 開設者を照合できなかった施設（手修正の候補つき）
"""
import csv, json, re, sys, glob, pathlib, collections, unicodedata, datetime
from python_calamine import CalamineWorkbook
from dbfread import DBF

RAW, MATCH, OVERRIDE, OUT = map(pathlib.Path, sys.argv[1:5])
OUT.mkdir(parents=True, exist_ok=True)
log = []

PREFS = "北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄".split()
MDC = ["神経系", "眼科系", "耳鼻咽喉科系", "呼吸器系", "循環器系", "消化器系・肝胆膵", "筋骨格系", "皮膚・皮下組織", "乳房",
       "内分泌・栄養・代謝", "腎・尿路系・男性生殖器", "女性生殖器・産褥・異常妊娠分娩", "血液・造血器・免疫臓器", "新生児・先天性奇形",
       "小児疾患", "外傷・熱傷・中毒", "精神疾患", "その他"]
AKITA = {"北秋田": "県北", "大館・鹿角": "県北", "能代・山本": "県北", "秋田周辺": "県央", "由利本荘・にかほ": "県央",
         "大仙・仙北": "県南", "横手": "県南", "湯沢・雄勝": "県南"}
ALIAS = {"40305": "40231", "04423": "04216", "22138": "22131", "22139": "22135", "22140": "22137"}

def nk(s): return unicodedata.normalize("NFKC", str(s if s is not None else "")).strip()

def num(v, nd=None):
    """数値。'-'（10件未満の秘匿）や空欄は None"""
    if isinstance(v, (int, float)):
        x = float(v)
    else:
        s = nk(v).replace(",", "")
        try: x = float(s)
        except ValueError: return None
    return round(x, nd) if nd is not None else x

def book(key):
    fs = [f for f in glob.glob(str(RAW / "dpc" / "*.xlsx")) if key in f]
    if len(fs) != 1: raise RuntimeError(f"file for {key}: {fs}")
    return CalamineWorkbook.from_path(fs[0])

def sheet(key, name=None, idx=0):
    wb = book(key)
    s = name if name else wb.sheet_names[idx]
    return wb.get_sheet_by_name(s).to_python(skip_empty_area=False)

def by_id(rows):
    """告示番号（5桁）で始まる行を辞書化。2行で1施設の表（手術有無）は呼び出し側で処理"""
    d = {}
    for r in rows:
        k = nk(r[0])
        if re.fullmatch(r"\d{5}", k): d[k] = r
    return d

# ---------- 施設概要表 ----------
fac_rows = sheet("施設概要表", "施設概要表")
muni_area = {}
for r in DBF(str(RAW / "geo" / "A38-20_1.dbf"), encoding="cp932"):
    p = PREFS[int(r["A38a_001"][:2]) - 1]; a = r["A38a_004"]
    if p == "秋田": a = AKITA.get(a, a)
    muni_area[r["A38a_001"]] = f"{p}|{a}"

def htype(s):
    if "DPC参加病院" in s: return "DPC"
    if "準備病院" in s: return "準備"
    if "出来高算定病院" in s: return "出来高"
    return "その他"

H = collections.OrderedDict()
for r in fac_rows[1:]:
    k = nk(r[0])
    if not re.fullmatch(r"\d{5}", k): continue
    muni = nk(r[2]).zfill(5)
    H[k] = {"id": k, "name": nk(r[4]), "pref": nk(r[3]), "muni": muni, "area": muni_area.get(ALIAS.get(muni, muni)),
            "type": htype(nk(r[5])), "join": nk(r[5]), "kihon": nk(r[7]) if nk(r[7]) not in ("-", "") else None,
            "b_dpc": num(r[6]), "b_kaifuku": num(r[9]), "b_chiiki": num(r[10]), "b_chiikiiryo": num(r[11]),
            "b_seishin": num(r[12]), "b_ryoyo": num(r[13]), "b_kekkaku": num(r[14]), "b_total": num(r[15]), "months": num(r[16])}
log.append(f"facilities {len(H)}, no area {sum(1 for h in H.values() if not h['area'])}")

# ---------- 開設者 ----------
match = {r["kokuji"]: r for r in csv.DictReader(open(MATCH, encoding="utf-8"))}
override = {}
if OVERRIDE.exists():
    for r in csv.DictReader(open(OVERRIDE, encoding="utf-8")):
        if nk(r.get("kokuji")): override[nk(r["kokuji"]).zfill(5)] = nk(r.get("corp_name"))
def infer_corp(name):
    """厚生局一覧表と照合できない施設のうち、施設名に全国規模の法人名を含むものは法人を推定する"""
    n = nk(name).replace(" ", "")
    for pat, corp in [(r"国立病院機構", "独立行政法人国立病院機構"), (r"労働者健康安全機構|労災病院", "独立行政法人労働者健康安全機構"),
                      (r"地域医療機能推進機構", "独立行政法人地域医療機能推進機構"), (r"赤十字", "日本赤十字社"), (r"済生会", "社会福祉法人恩賜財団済生会"),
                      (r"国家公務員共済組合連合会", "国家公務員共済組合連合会"), (r"公立学校共済組合", "公立学校共済組合")]:
        if re.search(pat, n): return corp
    m = re.search(r"((北海道|.{2,3}県)厚生農業協同組合連合会)", n)
    if m: return m.group(1)
    return None

review = []
for k, h in H.items():
    m = match.get(k, {})
    if k in override:
        h["corp"] = override[k] or None; h["corp_key"] = override[k] or None; h["corp_src"] = "手修正"
    elif m.get("conf") in ("A", "B") and m.get("corp_key"):
        h["corp"] = m["corp"]; h["corp_key"] = m["corp_key"]; h["corp_src"] = "厚生局一覧表"
        h["owner"] = m.get("owner")
    elif infer_corp(h["name"]):
        h["corp"] = h["corp_key"] = infer_corp(h["name"]); h["corp_src"] = "施設名から推定"
    else:
        h["corp"] = None; h["corp_key"] = None; h["corp_src"] = "不明"
        review.append({"kokuji": k, "name": h["name"], "pref": h["pref"], "beds": h["b_total"], "candidate_name": m.get("k_name", ""),
                       "candidate_owner": m.get("owner", ""), "candidate_corp": m.get("corp", ""), "conf": m.get("conf", "N")})

# ---------- (2) 在院日数の状況（一般病棟のみ） ----------
for k, r in by_id(sheet("２_在院日数の状況", "在院日数の状況")).items():
    if k in H:
        H[k].update({"n5": num(r[3]), "los5": num(r[4], 3), "n6": num(r[11]), "los6": num(r[12], 3), "med6": num(r[16])})

# ---------- (13) 在院日数の指標・患者構成の指標 ----------
mdcd = collections.defaultdict(dict)
r13 = sheet("１３_在院日数の平均の差_MDC", "R06全体")
nat_mdc = {}
for r in r13:
    if nk(r[3]) == "全国平均値":
        nat_los = num(r[4], 3)
        for i in range(18):
            nat_mdc[i] = num(r[11 + 6 * i + 1], 3)
for k, r in by_id(r13).items():
    if k not in H: continue
    H[k].update({"cmi6": num(r[6], 4), "eff6": num(r[8], 4), "kinds6": num(r[9])})
    mdcd[k]["los"] = [[num(r[11 + 6 * i]), num(r[12 + 6 * i], 2), num(r[14 + 6 * i], 3), num(r[16 + 6 * i], 3)] for i in range(18)]
for k, r in by_id(sheet("１３_在院日数の平均の差_MDC", "R05全体")).items():
    if k in H: H[k].update({"cmi5": num(r[6], 4), "eff5": num(r[8], 4)})

# ---------- (4)(5)(6) 救急車・予定外/救急医療入院・紹介 ----------
for k, r in by_id(sheet("４_救急車", None)).items():
    if k in H: H[k].update({"amb5": num(r[3], 4), "amb6": num(r[4], 4), "ambm5": num(r[5], 1), "ambm6": num(r[6], 1)})
for k, r in by_id(sheet("５_救急医療入院", None)).items():
    if k in H: H[k].update({"unp5": num(r[3], 4), "unp6": num(r[4], 4), "emg5": num(r[5], 4), "emg6": num(r[6], 4),
                            "unpm5": num(r[7], 1), "unpm6": num(r[8], 1), "emgm5": num(r[9], 1), "emgm6": num(r[10], 1)})
for k, r in by_id(sheet("６_他院", None)).items():
    if k in H: H[k].update({"ref5": num(r[3], 4), "ref6": num(r[4], 4), "refm5": num(r[5], 1), "refm6": num(r[6], 1)})

# ---------- (7) 入院経路・退院先 / (8) 転帰 / (9) 再入院 ----------
ROUTE = ["家庭から", "他院から転院", "介護・福祉施設から", "院内出生", "その他"]
DEST = ["家庭（当院通院）", "家庭（他院通院）", "家庭（その他）", "他院へ転院", "老健", "特養", "社会福祉施設・有料老人ホーム等", "終了（死亡等）", "その他", "介護医療院"]
OUTC = ["治癒・軽快", "寛解", "不変", "増悪", "最資源傷病による死亡", "最資源傷病以外による死亡", "その他"]
READM = ["再入院（計）", "同一疾患・4週以内", "同一疾患・4週超", "異なる疾患・4週以内", "異なる疾患・4週超"]
def pair(r, start, n): return [[num(x, 4) for x in r[start:start + n]], [num(x, 4) for x in r[start + n:start + 2 * n]]]
for k, r in by_id(sheet("７_入院経路", "入院経路")).items():
    if k in H: H[k]["route"] = pair(r, 3, 5)
for k, r in by_id(sheet("７_入院経路", "退院先")).items():
    if k in H: H[k]["dest"] = pair(r, 3, 10)
for k, r in by_id(sheet("８_退院時転帰", None)).items():
    if k in H: H[k]["outc"] = pair(r, 3, 7)
for k, r in by_id(sheet("９_再入院の状況", "再入院の状況")).items():
    if k in H: H[k]["readm"] = pair(r, 3, 5)

# ---------- (11) 施設別MDC比率 ----------
for k, r in by_id(sheet("１１_施設別MDC", "施設別MDC別比率")).items():
    if k in H:
        H[k]["mdc6"] = [num(x, 5) for x in r[3:21]]; H[k]["mdcn6"] = num(r[22])

# ---------- (14) 手術・化学療法・放射線療法・全身麻酔 ----------
for k, r in by_id(sheet("１４_手術化学", "高度医療")).items():
    if k in H:
        H[k]["adv"] = [num(x) for x in r[3:10]]  # 総数, 手術, 化学療法, 放射線療法, 救急車搬送, いずれか, 全身麻酔

# ---------- 参考2 (1) MDC別 手術有無別件数 ----------
rows = sheet("参考資料２__１_MDC別医療機関", "件数")
cur = None
for r in rows:
    k = nk(r[0])
    if re.fullmatch(r"\d{5}", k): cur = k
    if cur and nk(r[3]) in ("無し", "有り") and cur in H:
        mdcd[cur]["surg_" + ("no" if nk(r[3]) == "無し" else "yes")] = [num(x) for x in r[4:22]]
    if not k and not nk(r[3]): cur = None if not nk(r[2]) else cur

# ---------- 参考2 (2) MDC別 予定・救急医療入院 ----------
for k, r in by_id(sheet("参考資料２__２_予定", None)).items():
    if k in H:
        mdcd[k]["adm"] = [[num(x) for x in r[3 + 4 * i: 7 + 4 * i]] for i in range(18)]  # 予定, 化学療法再入院, 予定外, 救急医療入院

# ---------- 参考2 (3) MDC別 救急車による搬送 ----------
for k, r in by_id(sheet("参考資料２__３_救急車", None)).items():
    if k in H:
        mdcd[k]["amb"] = [[num(r[3 + 2 * i]), num(r[4 + 2 * i])] for i in range(18)]  # 救急車による搬送, 合計（搬送の10件未満は None）

# ---------- 参考2 (4) 入院から24時間以内の死亡 ----------
for k, r in by_id(sheet("参考資料２__４_入院から", None)).items():
    if k in H:
        d24 = [[num(r[3 + 2 * i]), num(r[4 + 2 * i])] for i in range(18)]
        mdcd[k]["d24"] = d24
        tot = sum(x[1] or 0 for x in d24); dead = sum(x[0] or 0 for x in d24)
        H[k]["d24"] = [dead, tot]  # 秘匿（10件未満）分は 0 として合算

# ---------- 参考3 (1) 再入院・再転棟 / (2) 後発医薬品 ----------
for k, r in by_id(sheet("参考資料３__１_再入院", "令和6年度")).items():
    if k in H:
        H[k]["readm3"] = [num(r[3], 4), num(r[4], 5), num(r[9], 4), num(r[10], 4), num(r[11], 4), num(r[12], 4), num(r[13], 4), num(r[14], 4)]
        # 再入院率, 再転棟率, 同一病名(計画的, 計画的_化学療法以外, 計画外), 異なる病名(計画的, 計画的_化学療法以外, 計画外)
for k, r in by_id(sheet("参考資料３__２_後発", None)).items():
    if k in H: H[k]["gen6"] = num(r[3], 4)

# ---------- (17) 二次医療圏別 MDC別患者数（患者住所地ベース） ----------
areas = {}
for r in sheet("１７_医療圏別", "二次医療圏_MDC別")[2:]:
    p, a = nk(r[0]), nk(r[1])
    if p and a and p != "不明":
        areas[f"{p}|{a}"] = {"pref": p, "name": a, "res": [num(x) for x in r[2:20]]}
missing = sorted({h["area"] for h in H.values() if h["area"] and h["area"] not in areas})
log.append(f"areas {len(areas)}, hospital areas not in official list: {missing[:10]}")

# ---------- 出力 ----------
COLS = ["id", "name", "pref", "area", "type", "kihon", "b_dpc", "b_total", "b_kaifuku", "b_chiiki", "b_chiikiiryo", "b_seishin", "b_ryoyo",
        "months", "corp", "corp_key", "corp_src", "n5", "n6", "los5", "los6", "med6", "cmi5", "cmi6", "eff5", "eff6", "kinds6",
        "amb5", "amb6", "ambm5", "ambm6", "unp5", "unp6", "emg5", "emg6", "unpm5", "unpm6", "emgm5", "emgm6",
        "ref5", "ref6", "refm5", "refm6", "route", "dest", "outc", "readm", "mdc6", "mdcn6", "adv", "d24", "readm3", "gen6"]
core = {"cols": COLS, "rows": [[h.get(c) for c in COLS] for h in H.values()]}
meta = {"built_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"), "mdc": MDC, "route": ROUTE, "dest": DEST, "outc": OUTC,
        "readm": READM, "nat_los": nat_los, "nat_mdc_los": [nat_mdc.get(i) for i in range(18)],
        "adv": ["総数", "手術", "化学療法", "放射線療法", "救急車搬送", "いずれか", "全身麻酔"],
        "readm3": ["再入院率", "再転棟率", "同一病名・計画的", "同一病名・計画的（化学療法以外）", "同一病名・計画外", "異なる病名・計画的", "異なる病名・計画的（化学療法以外）", "異なる病名・計画外"],
        "counts": dict(collections.Counter(h["type"] for h in H.values())),
        "owner": dict(collections.Counter(h["corp_src"] for h in H.values()))}
def dump(name, obj):
    p = OUT / name; p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.append(f"{name}: {p.stat().st_size/1e6:.2f} MB")
dump("core.json", core)
dump("mdc.json", mdcd)
dump("areas.json", {"meta": meta, "areas": areas})
with open(OUT / "owner_review.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["kokuji", "name", "pref", "beds", "candidate_name", "candidate_owner", "candidate_corp", "conf"])
    w.writeheader(); w.writerows(review)
log.append(f"owner: {meta['owner']}, review {len(review)}")
print("\n".join(log))
