"use strict";
/* 使い方：使い方パネル／初回ガイドツアー／各チャートの「？」
   説明文はすべてこのファイルにまとめている（画面の文言を直すときはここを編集） */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const vizRoot = document.querySelector(".viz-root");

  /* ---------- 各チャートの説明（キー＝カードの data-chart） ---------- */
  const C = {
    radar: { t: "比較対象の平均との比較（レーダー）", what: "主要8指標について、自院の値を比較対象の他院平均（自院を除く単純平均）＝100とした指数で表します。",
      how: "青い線が外側（100より大きい）ほど、他院平均より値が大きいことを表します。灰色の線が100の位置です。",
      hint: "外に張り出した指標は自院の強み、内側にへこんだ指標は伸びしろの候補として見るのが一般的です。",
      note: "値が大きいほど良いとは限りません（例：患者構成の指標は「複雑さ」を表します）。250を超える値は外周に表示しています。" },
    ranks: { t: "比較対象内の順位", what: "主な指標について、比較対象の中で自院が何位かを示します。",
      how: "バーが右に伸びているほど上位です。平均在院日数・死亡退院率・計画外再入院率は「低いほど上位」です。",
      hint: "上位の指標は対外的なアピール材料、下位の指標は改善テーマの候補になります。", note: "比較対象の施設数が少ないと、順位の意味は小さくなります。" },
    "rank-n": { t: "退院患者数のランキング", what: "令和6年度（令和6年6月〜令和7年5月）の退院患者数（一般病棟、分析対象分）です。",
      how: "青が自院、灰色が他院です。縦線は他院平均です。", hint: "地域の中での規模の位置づけを確認できます。前年度比はサマリーのカードで確認できます。",
      note: "在院日数1日以下などの分析対象外の患者は含みません。" },
    "sc-beds": { t: "病床数と退院患者数", what: "横軸が病床数、縦軸が退院患者数です。1つの点が1病院です。",
      how: "同じ病床数で上にある病院ほど、病床あたりの退院患者数が多い（病床の回転が速い）ことを表します。",
      hint: "自院が他院より下にある場合、在院日数や病床の使い方を見直す余地があるかもしれません。", note: "▲は軸の範囲外の値で、端に寄せて表示しています。" },
    beds: { t: "病床の構成", what: "医療保険の病床数を、DPC算定病床・回復期リハ・地域包括ケア／地域包括医療・療養・精神・その他に分けて示します。",
      how: "棒の長さが総病床数、色の割合が病床の構成です。", hint: "急性期中心か、回復期・地域包括ケアを組み合わせたケアミックス型かがわかります。", note: "施設概要表の病床数です。" },
    "mdc-share": { t: "MDC別のシェア", what: "MDC（主要診断群：病気の大きな分類）ごとに、比較対象の病院の患者数の合計に占める自院の割合です。",
      how: "括弧内は比較対象内の順位です。", hint: "シェアが高いMDCは地域で中心的な役割を担っている分野、低いMDCは他院に患者が流れている可能性がある分野です。",
      note: "病院の所在地で数えた患者数です。10件未満のMDCは秘匿されています。" },
    "mdc-mix": { t: "MDC構成比", what: "自院の患者がどのMDCに多いかの内訳を、比較対象全体の内訳と並べます。",
      how: "青（自院）が灰色（比較対象全体）より長いMDCは、自院が特に多く診ている分野です。", hint: "自院の「得意分野」を地域の平均的な構成と比べて確認できます。", note: "" },
    heat: { t: "病院×MDCのヒートマップ", what: "比較対象の主な病院について、MDCごとの患者数を色の濃さで示します。",
      how: "色はそのMDCの比較対象内シェアです。濃いほどそのMDCで大きなシェアを持っています。", hint: "どの分野をどの病院が担っているか（競合関係）を一目で把握できます。",
      note: "患者数の多い上位の病院を表示しています。全病院は比較表を参照してください。" },
    flow: { t: "医療圏の患者の流出入", what: "医療圏内の病院が受け入れた患者数と、その医療圏に住む患者の数を比べます。",
      how: "プラスは他の医療圏から患者が流入している、マイナスは他の医療圏へ流出していることを表します。",
      hint: "流出超過のMDCは、地域内で受け皿が不足している可能性がある分野として読めます（新規参入や強化の検討材料）。",
      note: "患者の住所地は郵便番号で集計され、複数の医療圏にまたがる郵便番号は重複計上されます。二次医療圏の比較軸のときだけ表示します。" },
    "sc-eff": { t: "患者構成の指標と在院日数の指標", what: "横軸が患者構成の指標（複雑さ）、縦軸が在院日数の指標（効率性）です。いずれも全国平均＝1です。",
      how: "右ほど在院日数が長くなりやすい患者を多く診ており、上ほど同じ患者構成でも在院日数が短い（効率的）ことを表します。",
      hint: "右上は「複雑な患者を効率よく診ている」、左下は「単純な患者構成なのに在院日数が長め」の位置です。",
      note: "▲は軸の範囲外の値です。DPC機能評価係数Ⅱの効率性・複雑性に近い考え方ですが、係数そのものではありません。" },
    "mdc-eff": { t: "自院のMDC別 在院日数の指標", what: "MDCごとの在院日数の指標です（1＝全国平均）。",
      how: "青は全国平均より在院日数が短い、赤は長いMDCです。", hint: "赤のMDCはクリニカルパスや退院支援の見直し候補として見られます。", note: "10件未満のMDCは表示されません。" },
    "rank-los": { t: "平均在院日数のランキング", what: "一般病棟の平均在院日数です。短い順に並べています。", how: "縦線は他院平均です。",
      hint: "在院日数は患者構成に左右されるため、効率性は「在院日数の指標」と合わせて見るのがおすすめです。", note: "" },
    "rank-amb": { t: "救急車搬送の件数（1か月あたり）", what: "救急車で搬送されて入院した患者の月あたり件数です。", how: "縦線は他院平均です。",
      hint: "地域の救急医療での役割の大きさを示します。", note: "" },
    "sc-amb": { t: "救急車搬送と手術の件数", what: "横軸が救急車搬送（月）、縦軸が手術ありの件数です。",
      how: "右上ほど、救急と手術の両方を多く担う病院です。", hint: "救急で受けた患者を手術まで完結できているかの目安になります。", note: "▲は軸の範囲外の値です。" },
    "rank-emg": { t: "救急医療入院の件数（1か月あたり）", what: "様式1で「救急医療入院」とされた患者の月あたり件数です。", how: "縦線は他院平均です。",
      hint: "救急医療管理加算などの対象となる、緊急性の高い入院の規模を表します。", note: "" },
    "mdc-emg": { t: "自院のMDC別 救急医療入院", what: "救急医療入院の年間件数をMDC別に示し、比較対象内のシェアを添えています。", how: "", hint: "救急で強い疾患分野を確認できます。", note: "–は10件未満（秘匿）です。" },
    "adm-self": { t: "自院のMDC別 入院区分の構成", what: "MDCごとに、入院が「予定入院」「化学療法実施の再入院」「予定外入院」「救急医療入院」のどれだったかの構成比です。",
      how: "＊の行は秘匿値の推計を含みます。灰色は秘匿で内訳がわからない部分です。", hint: "予定入院が多いMDCは紹介・外来経由、救急医療入院が多いMDCは救急経由で患者を得ている分野です。",
      note: "推計の方法はこのチャートの上の説明を参照してください。" },
    "adm-group": { t: "比較対象全体のMDC別 入院区分の構成", what: "比較対象の病院を合計した入院区分の構成比です。", how: "自院のチャートと左右で見比べます。",
      hint: "地域全体と比べて、自院が救急寄りか予定入院寄りかがわかります。", note: "" },
    "adm-sc": { t: "予定入院シェアと救急医療入院シェア", what: "自院の各MDCを点で表し、横軸に比較対象内の予定入院シェア、縦軸に救急医療入院シェアをとります。",
      how: "斜めの線より上は救急で、下は予定入院でシェアが高いMDCです。", hint: "救急で強いのに予定入院のシェアが低い分野は、紹介や外来の強化で予定入院を増やせる余地があるかもしれません。",
      note: "重なった名前は非表示です（「表」で確認できます）。" },
    "adm-rate": { t: "救急医療入院の割合（MDC別）", what: "MDCごとの救急医療入院の割合を、自院と比較対象全体で比べます。", how: "", hint: "", note: "推計値を含みます。" },
    "adm-rank": { t: "選んだMDC・区分の件数ランキング", what: "上で選んだMDCと入院区分の件数です。", how: "プルダウンでMDCと区分を切り替えられます。", hint: "", note: "推計を含む値はツールチップに表示されます。" },
    "adm-comp": { t: "選んだMDCの入院区分の構成", what: "上で選んだMDCについて、自院・比較対象全体・主な他院の入院区分の構成比です。", how: "", hint: "", note: "" },
    "ambm-rate": { t: "救急車搬送率（MDC別）", what: "MDCごとに、入院患者のうち救急車で搬送された割合です。", how: "括弧内は自院の件数です。",
      hint: "比較対象全体より高いMDCは、自院が救急車を多く受け入れている分野です。", note: "10件未満は秘匿のため率を表示していません。" },
    "ambm-share": { t: "救急車搬送のシェア（MDC別）", what: "比較対象の病院が受けた救急車搬送のうち、自院が受けた割合です。", how: "括弧内は順位です。",
      hint: "地域の救急の受け皿としての役割を、疾患分野ごとに確認できます。", note: "秘匿されたセルは合計から除いています。" },
    "ambm-mix": { t: "救急車搬送の疾患構成", what: "救急車で搬送された患者が、どのMDCで入院したかの内訳です。", how: "横軸はMDC番号です（名称は「表」で確認できます）。",
      hint: "", note: "" },
    "ambm-rank": { t: "選んだMDCの救急車搬送件数", what: "上で選んだMDCの救急車搬送の件数です。", how: "", hint: "", note: "10件未満の病院は表示されません。" },
    "ambm-sc": { t: "合計件数と救急車搬送率", what: "上で選んだMDCについて、横軸が合計件数、縦軸が救急車搬送率です。", how: "横線は比較対象全体の搬送率です。",
      hint: "右上ほど、その分野で規模が大きく救急車の受け入れも多い病院です。", note: "" },
    "rank-ref": { t: "他院からの紹介率", what: "入院患者のうち、他の医療機関から紹介された患者の割合です。", how: "縦線は他院平均です。",
      hint: "地域の診療所・病院からの信頼度や、地域連携の強さの目安になります。", note: "" },
    route: { t: "入院経路", what: "患者がどこから入院したかの構成比です。", how: "上から自院、比較対象全体、主な他院の順です。",
      hint: "「他院から転院」が多い病院は、地域で高度な治療の受け皿になっていると読めます。", note: "" },
    dest: { t: "退院先", what: "患者がどこへ退院したかの構成比です。", how: "",
      hint: "「他院へ転院」が多い場合は、後方病院（回復期・慢性期）との連携が重要になります。", note: "" },
    "rank-surg": { t: "手術ありの件数", what: "手術を行った退院患者の件数です。", how: "", hint: "", note: "" },
    "rank-ga": { t: "全身麻酔ありの件数", what: "全身麻酔を行った退院患者の件数です。", how: "", hint: "手術室の稼働や麻酔科体制の規模の目安になります。", note: "" },
    "adv-rate": { t: "手術・化学療法・放射線療法・全身麻酔の割合", what: "退院患者に占める、それぞれを実施した患者の割合を、自院と比較対象全体で比べます。", how: "", hint: "", note: "" },
    "rank-death": { t: "死亡退院率", what: "退院患者に占める、死亡退院の割合です。低い順に並べています。", how: "",
      hint: "", note: "重症度や疾患構成に大きく左右されるため、単純な比較で医療の質を判断しないでください。" },
    "rank-readm": { t: "4週以内の計画外再入院率", what: "退院後4週以内に、予定していなかった再入院をした患者の割合です。低い順に並べています。", how: "",
      hint: "退院支援や退院後のフォローの質を考える手がかりになります。", note: "" },
    "rank-gen": { t: "後発医薬品の使用割合", what: "一般病棟で使われた医薬品のうち、後発医薬品（ジェネリック）の割合です。", how: "",
      hint: "後発医薬品使用体制加算などの算定状況の目安になります。", note: "" },
    "surg-top": { t: "自院の主要な手術", what: "自院の件数が多い順に、手術区分（DPCの疾患×手術の分類）を20件まで示します。",
      how: "括弧内は比較対象内の順位とシェアです。バーをクリックすると、下の「手術を選んで比較」に表示されます。",
      hint: "シェアが高い手術は地域での強み、件数は多いのにシェアが低い手術は競合が多い分野です。", note: "10件未満の手術区分は秘匿されています。" },
    "surg-rank": { t: "選んだ手術の件数比較", what: "上の検索欄で選んだ手術区分の件数を、比較対象の病院で比べます。", how: "検索欄には疾患名・手術名・Kコードを入れられます（例：「K5493 心筋梗塞」）。", hint: "", note: "" },
    "surg-sc": { t: "選んだ手術の件数と平均在院日数", what: "横軸が件数、縦軸がその手術の平均在院日数です。", how: "横線は比較対象全体の平均在院日数です。",
      hint: "同じ手術で他院より在院日数が長い場合は、クリニカルパスの見直しの余地があるかもしれません。", note: "" },
    "surg-heat": { t: "手術シェアのヒートマップ", what: "自院の主要な手術（列）について、比較対象の病院ごとのシェアを色の濃さで示します。", how: "", hint: "手術ごとの競合病院を把握できます。", note: "空白は10件未満または実績なしです。" },
    "fim-sc": { t: "FIM：入棟時の重度割合と退棟時の高得点帯の割合", what: "回復期リハビリテーション病棟等の患者について、横軸が入棟時に運動FIMが13〜26点（重度）の割合、縦軸が退棟時に53〜91点の割合です。",
      how: "右上ほど、重い患者を受け入れつつ、退棟時に高い得点帯の患者が多い病院です。",
      hint: "", note: "公表されているのは点数帯の割合だけで、FIM利得（改善点数）は公表されていません。回復期リハ病棟は出来高算定病院に多いため、「出来高算定病院も含む」にすると比較できる病院が増えます。" },
    "fim-rank": { t: "運動FIM 53点以上の割合の増加", what: "退棟時と入棟時で、運動FIMが53点以上の患者の割合がどれだけ増えたか（ポイント）です。",
      how: "", hint: "リハビリの成果の目安として使える代わりの指標です。", note: "患者ごとの改善度ではありません。" },
    "fim-in": { t: "FIM：入棟時の点数帯", what: "入棟時のFIMの点数帯の構成比です。上の切り替えで運動項目と認知項目を選べます。", how: "", hint: "", note: "" },
    "fim-out": { t: "FIM：退棟時の点数帯", what: "退棟時のFIMの点数帯の構成比です。", how: "", hint: "", note: "" },
    "sev-rank": { t: "重症度：代表指標のランキング", what: "上で選んだ項目の代表的な指標（例：脳卒中の発症3日以内の割合）を比べます。",
      how: "ツールチップに、おおよその対象人数を表示します。", hint: "", note: "患者構成の調整はしていません。対象人数が少ない病院は値が大きくぶれます。" },
    "sev-comp": { t: "重症度：分類ごとの割合", what: "上で選んだ項目の分類ごとの割合を、自院と比較対象全体で比べます。", how: "", hint: "", note: "P/F比・NYHA・分娩時出血量は、重症度ではなく入力精度（不明の割合）を表します。" },
  };

  /* ---------- 用語集・よくある質問 ---------- */
  const GLOSSARY = [
    ["DPC", "診断群分類（Diagnosis Procedure Combination）。病名と治療内容で入院患者を分類し、1日あたりの定額で支払う仕組み。この調査はDPCのデータ提出病院（DPC参加・準備・出来高算定病院）が対象です。"],
    ["退院患者調査", "厚生労働省がDPCデータをもとに毎年公表する集計。このツールは令和6年度（令和6年6月〜令和7年5月の退院）を使っています。"],
    ["MDC", "主要診断群（Major Diagnostic Category）。01 神経系〜18 その他の18分類で、病気を臓器・系統ごとに大きく分けたもの。"],
    ["手術区分", "DPCの疾患コード（6桁）と手術の分類（9〜10桁目）の組み合わせ。1つの区分に複数の手術（Kコード）が含まれます。"],
    ["在院日数の指標", "全国平均の在院日数を、自院の患者構成で補正した在院日数で割った値。1より大きいほど在院日数が短い（効率的）。"],
    ["患者構成の指標", "自院の患者構成で全国平均の在院日数を当てはめたときの在院日数 ÷ 全国平均の在院日数。1より大きいほど在院日数が長くなりやすい（複雑な）患者を多く診ている。"],
    ["救急医療入院", "様式1で、救急医療が必要な状態で入院したとされた患者。救急車搬送の有無とは別の項目です。"],
    ["予定外入院", "予定していなかった入院のうち、救急医療入院に当たらないもの。"],
    ["二次医療圏", "一般的な入院医療を地域で完結させる単位として都道府県が定める区域。このツールは第8次医療計画の330圏です。"],
    ["類似病院", "自院と入院基本料の系統が同じ病院のうち、病床数と病床構成が近い順に選んだ病院群。近さの計算方法は「類似病院の選び方と一覧」に記載しています。"],
    ["比較対象全体", "比較対象の病院を合計した値（件数で重み付け）。"],
    ["他院平均", "自院を除く比較対象の病院の単純平均。"],
    ["秘匿（–）", "公表データで10件未満の値は「–」で伏せられています。小さな病院や患者の少ない分野で多く見られます。"],
    ["推計", "秘匿された値を、合計との差し引きで求めた値。画面では「推計」または「＊」で区別しています。"],
    ["FIM", "機能的自立度評価法。運動13項目（13〜91点）と認知5項目（5〜35点）で日常生活の自立度を評価します。点数が高いほど自立。"],
    ["mRS（modified Rankin Scale）", "脳卒中などの後の障害の程度を0（症状なし）〜5（重度の障害）、6（死亡）で表す指標。"],
  ];
  const FAQ = [
    ["値が「–」になっているのはなぜ？", "公表データで10件未満の値は秘匿されているためです。データそのものがない場合も「–」になります。"],
    ["「法人不明」とは？", "地方厚生局の医療機関一覧表（令和8年10月時点）と照合できなかった病院です。閉院・統合・名称変更などが主な理由です。"],
    ["比較対象が自院だけになる", "条件に合う他院がない状態です。「比較対象」で「出来高算定病院も含む」にするか、比較軸を切り替えてください。"],
    ["表示中の画面を他の人と共有したい", "ブラウザのアドレス欄のURLをそのまま送ってください。自院・比較軸・比較対象の条件がURLに含まれています。"],
    ["データをExcelで使いたい", "ページ下部の「比較表」の「CSVダウンロード」から、比較対象の主要指標をダウンロードできます。各チャートの「表」ボタンでも数値を確認できます。"],
    ["データの時点は？", "診療実績は令和6年度（令和6年6月〜令和7年5月の退院）、法人（開設者）は令和8年10月時点です。"],
  ];
  const SECTIONS = [
    ["サマリー", "主な指標の値、前年度比、比較対象内の順位、他院平均との比較（レーダー）。まずここで全体像をつかみます。"],
    ["1 規模・概要", "退院患者数、病床数と構成。地域の中での規模の位置づけ。"],
    ["2 疾患構成・シェア", "MDC別のシェアと構成、病院×MDCのヒートマップ、医療圏の患者の流出入。どの分野が強いか・競合はどこか。"],
    ["3 効率性・複雑性", "在院日数の指標と患者構成の指標、MDC別の効率性、平均在院日数。"],
    ["4 救急", "救急車搬送・救急医療入院の件数、入院区分（予定・救急）と救急車搬送のMDC別分析。"],
    ["5 地域連携", "紹介率、入院経路、退院先。"],
    ["6 手術・高度医療", "手術・全身麻酔・化学療法・放射線療法の件数と割合。"],
    ["7 医療の質", "死亡退院率、計画外再入院率。"],
    ["8 薬剤", "後発医薬品の使用割合。"],
    ["9 手術別の実績", "疾患×手術区分ごとの件数・在院日数。自院の主要な手術、手術を選んでの比較、手術シェアのヒートマップ。"],
    ["10 重症度・リハビリ", "回復期リハのFIM、疾患別の重症度16項目。"],
    ["比較表", "比較対象の全病院の主要指標の一覧。列名をクリックで並べ替え、CSVでダウンロード。"],
  ];

  /* ---------- 使い方パネル ---------- */
  function buildPanel() {
    const panel = el("aside", "help-panel"); panel.id = "help"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-labelledby", "help-title"); panel.hidden = true;
    const sec = (id, title, body) => `<section class="hp-sec" id="${id}"><h3>${title}</h3>${body}</section>`;
    panel.innerHTML = `
      <div class="hp-head"><h2 id="help-title">使い方</h2><button type="button" class="hp-close" aria-label="使い方を閉じる">×</button></div>
      <nav class="hp-nav"><a href="#hp-start">はじめに</a><a href="#hp-view">画面の見方</a><a href="#hp-sec">各セクション</a><a href="#hp-glossary">用語集</a><a href="#hp-faq">よくある質問</a></nav>
      <div class="hp-body">
        <p><button type="button" class="ghost hp-tour">ガイドツアーを開始する</button></p>
        ${sec("hp-start", "はじめに：3ステップ", `<ol class="hp-steps">
          <li><b>自院を選ぶ</b>：画面上部の検索欄に病院名の一部を入れて、候補から選びます。</li>
          <li><b>比較軸を選ぶ</b>：<br>・<b>二次医療圏</b>：同じ地域の競合病院と比べる<br>・<b>法人</b>：同じ法人の病院どうしで比べる<br>・<b>類似病院</b>：入院基本料が同じ系統で、病床数・病床構成が近い病院と比べる（地域と施設数を調整できます）</li>
          <li><b>比較対象の範囲を選ぶ</b>：「DPC参加・準備病院」が初期値です。中小病院や回復期の病院も含めるときは「出来高算定病院も含む」にします。</li></ol>`)}
        ${sec("hp-view", "画面の見方", `<ul class="hp-list">
          <li><span class="sw sw-self"></span><b>青</b>＝自院、<span class="sw sw-other"></span><b>灰色</b>＝他院や比較対象全体です。</li>
          <li>ランキングの<b>縦線</b>は他院平均です。</li>
          <li>チャートに<b>マウスを乗せる（タップする）</b>と、病院名や正確な値が表示されます。</li>
          <li>各チャートの右上の<b>「表」</b>で、同じ内容を数値の表で見られます。</li>
          <li>見出し横の<b>「？」</b>で、そのチャートの見方を確認できます。</li>
          <li>「<b>読み方の例</b>」は、経営の視点での一般的な読み方の参考です。結論は、ほかの情報と合わせて判断してください。</li>
          <li>画面上部の条件はすべてのチャートに反映されます。URLに条件が入るので、そのまま共有できます。</li>
          <li>「表示：自動／ライト／ダーク」で画面の明るさを切り替えられます。</li></ul>`)}
        ${sec("hp-sec", "各セクションでわかること", `<dl class="hp-dl">${SECTIONS.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>`)}
        ${sec("hp-glossary", "用語集", `<dl class="hp-dl">${GLOSSARY.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>`)}
        ${sec("hp-faq", "よくある質問", `<dl class="hp-dl">${FAQ.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>`)}
        <p class="muted small">データの出典と注意事項は、ページ最下部の「データと注意事項」を参照してください。</p>
      </div>`;
    vizRoot.appendChild(panel);
    panel.querySelector(".hp-close").addEventListener("click", closePanel);
    panel.querySelector(".hp-tour").addEventListener("click", () => { closePanel(); startTour(); });
    panel.querySelectorAll(".hp-nav a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault();
      panel.querySelector(a.getAttribute("href")).scrollIntoView({ behavior: "smooth", block: "start" }); }));
    return panel;
  }
  let panel, lastFocus;
  function openPanel() { lastFocus = document.activeElement; panel.hidden = false; $("#help-open").setAttribute("aria-expanded", "true"); panel.querySelector(".hp-close").focus(); }
  function closePanel() { panel.hidden = true; $("#help-open").setAttribute("aria-expanded", "false"); if (lastFocus && lastFocus.focus) lastFocus.focus(); }

  /* ---------- 各チャートの「？」 ---------- */
  let pop;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function showPop(btn, key) {
    closePop();
    const d = C[key]; if (!d) return;
    pop = el("div", "help-pop"); pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", d.t + "の見方");
    pop.innerHTML = `<div class="hpop-head"><b>${d.t}</b><button type="button" class="hp-close" aria-label="閉じる">×</button></div>` +
      [["何を表すか", d.what], ["読み方", d.how], ["読み方の例", d.hint], ["注意点", d.note]].filter(([, v]) => v).map(([k, v]) => `<div class="hpop-row"><span class="hpop-k">${k}</span><p>${v}</p></div>`).join("");
    vizRoot.appendChild(pop);
    const r = btn.getBoundingClientRect(), w = Math.min(380, window.innerWidth - 24);
    pop.style.width = w + "px";
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left - w / 2));
    pop.style.left = left + "px";
    const below = r.bottom + 8, h = pop.offsetHeight;
    pop.style.top = (below + h > window.innerHeight - 12 ? Math.max(12, r.top - h - 8) : below) + "px";
    pop.querySelector(".hp-close").addEventListener("click", () => { closePop(); btn.focus(); });
    pop._t = Date.now();
    pop.querySelector(".hp-close").focus({ preventScroll: true });
  }
  function addHelpButtons() {
    document.querySelectorAll(".card").forEach((card) => {
      let key = card.dataset.chart;
      if (!key && card.querySelector("#ranks")) key = "ranks";
      if (!key || !C[key] || card.querySelector(".help-btn")) return;
      const h3 = card.querySelector("h3"); if (!h3) return;
      if (h3.id) {  // 見出しの文字を書き換えるチャートは、文字部分を<span>に移してボタンが消えないようにする
        const sp = el("span"); sp.id = h3.id; h3.removeAttribute("id"); sp.textContent = h3.textContent; h3.textContent = ""; h3.appendChild(sp);
      }
      const b = el("button", "help-btn", "?"); b.type = "button"; b.setAttribute("aria-label", C[key].t + "の見方");
      b.addEventListener("click", (e) => { e.stopPropagation(); showPop(b, key); });
      h3.appendChild(b);
    });
  }

  /* ---------- 初回ガイドツアー ---------- */
  const EXAMPLE = "20173";
  const STEPS = [
    { sel: null, t: "ようこそ", b: "このツールでは、厚生労働省の退院患者調査（令和6年度）をもとに、自院を地域の病院・同じ法人の病院・規模や機能が近い病院と比べられます。主な操作を順番にご案内します（約1分）。" },
    { sel: "#q", t: "1. 自院を選ぶ", b: "ここに病院名の一部を入れて、候補から自院を選びます。", needSelf: false,
      after: () => { if (!window.DPCApp.S.self) window.DPCApp.select(EXAMPLE); } },
    { sel: "#axis-seg", t: "2. 比較軸を選ぶ", b: "「二次医療圏」は同じ地域の競合、「法人」は同じ法人の病院、「類似病院」は入院基本料の系統が同じで、病床数・病床構成が近い病院と比べます。", needSelf: true },
    { sel: "#scope-seg", t: "3. 比較対象の範囲", b: "初めは「DPC参加・準備病院」です。中小病院や回復期の病院も含めたいときは「出来高算定病院も含む」を選びます。", needSelf: true },
    { sel: "#group-chip", t: "比較対象の確認", b: "いま何と比べているか（比較対象の名前と施設数）がここに表示されます。", needSelf: true },
    { sel: "#kpis", t: "サマリー", b: "主な指標の値、前年度比、比較対象内の順位です。まずここで全体像をつかみます。", needSelf: true },
    { sel: ".toc", t: "セクションへの移動", b: "見たい分析（規模、疾患構成、救急、手術別など）へここからジャンプできます。", needSelf: true },
    { sel: "#s-scale .card[data-chart] h3", t: "「表」と「？」", b: "各チャートの「？」でそのチャートの見方を、右上の「表」で数値の表を確認できます。チャートにマウスを乗せると詳しい値が出ます。", needSelf: true },
    { sel: "#help-open", t: "使い方はいつでもここから", b: "用語集やよくある質問は「使い方」にまとめています。このガイドもそこから何度でも再生できます。", needSelf: false },
  ];
  let tour = null;
  function endTour() {
    if (!tour) return;
    tour.hole.remove(); tour.box.remove(); window.removeEventListener("resize", tour.place); window.removeEventListener("scroll", tour.place, true);
    document.removeEventListener("keydown", tour.key); tour = null;
    try { localStorage.setItem("dpc_tour_done", "1"); } catch (e) {}
  }
  function startTour() {
    closePop(); endTour();
    const hole = el("div", "tour-hole"), box = el("div", "tour-box");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-live", "polite");
    vizRoot.append(hole, box);
    tour = { i: 0, hole, box };
    tour.place = () => place();
    tour.key = (e) => { if (e.key === "Escape") endTour(); else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("resize", tour.place); window.addEventListener("scroll", tour.place, true); document.addEventListener("keydown", tour.key);
    show();
  }
  function target() { const s = STEPS[tour.i]; if (!s.sel) return null; try { return document.querySelector(s.sel); } catch (e) { return null; } }
  function place() {
    if (!tour) return;
    const t = target(), box = tour.box, hole = tour.hole;
    if (!t || t.offsetParent === null) {
      hole.style.cssText = "left:50%;top:40%;width:0;height:0;";
      box.style.left = Math.max(12, (window.innerWidth - box.offsetWidth) / 2) + "px"; box.style.top = Math.max(12, window.innerHeight * 0.3) + "px"; return;
    }
    const r = t.getBoundingClientRect(), pad = 6;
    hole.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let top = r.bottom + 14; if (top + bh > window.innerHeight - 12) top = Math.max(12, r.top - bh - 14);
    box.style.left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left)) + "px"; box.style.top = top + "px";
  }
  function show() {
    const s = STEPS[tour.i], n = STEPS.length;
    tour.box.innerHTML = `<div class="tb-step">${tour.i + 1} / ${n}</div><h3>${s.t}</h3><p>${s.b}</p>` +
      (s.sel === "#q" && !window.DPCApp.S.self ? `<p class="muted small">「次へ」を押すと、例として済生会熊本病院を表示します。</p>` : "") +
      `<div class="tb-btns"><button type="button" class="ghost tb-skip">終了</button><span class="tb-sp"></span>` +
      (tour.i > 0 ? `<button type="button" class="ghost tb-prev">戻る</button>` : "") +
      `<button type="button" class="tb-next">${tour.i === n - 1 ? "完了" : "次へ"}</button></div>`;
    tour.box.querySelector(".tb-skip").addEventListener("click", endTour);
    tour.box.querySelector(".tb-next").addEventListener("click", () => go(1));
    const pv = tour.box.querySelector(".tb-prev"); if (pv) pv.addEventListener("click", () => go(-1));
    const t = target();
    if (t && t.offsetParent !== null) t.scrollIntoView({ behavior: "auto", block: "center" });
    requestAnimationFrame(() => { place(); tour && tour.box.querySelector(".tb-next").focus({ preventScroll: true }); });
  }
  function go(d) {
    if (!tour) return;
    const s = STEPS[tour.i];
    if (d > 0 && s.after) s.after();
    tour.i += d;
    if (tour.i >= STEPS.length) { endTour(); return; }
    if (tour.i < 0) tour.i = 0;
    setTimeout(show, d > 0 && s.after ? 300 : 0);
  }

  /* ---------- 起動 ---------- */
  function init() {
    panel = buildPanel();
    $("#help-open").setAttribute("aria-expanded", "false");
    $("#help-open").addEventListener("click", () => (panel.hidden ? openPanel() : closePanel()));
    const te = $("#tour-start-empty"); if (te) te.addEventListener("click", startTour);
    addHelpButtons();
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (pop) closePop(); else if (!panel.hidden && !tour) closePanel(); } });
    document.addEventListener("click", (e) => { if (pop && !pop.contains(e.target)) closePop(); });
    window.addEventListener("scroll", () => { if (pop && Date.now() - pop._t > 400) closePop(); }, { passive: true });
  }
  init();
  window.addEventListener("dpc:loaded", () => {
    let done = false; try { done = localStorage.getItem("dpc_tour_done") === "1"; } catch (e) { done = true; }
    if (!done) setTimeout(startTour, 600);
  });
})();
