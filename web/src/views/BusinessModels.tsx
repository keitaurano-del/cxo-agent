// BusinessModels — ビジネスモデル図鑑（MC-363）。
//
// 世の中の優れたビジネスモデル 12 種を「1 モデル = 1 図解」のカタログとして開発ページ配下に常設する。
// 各モデル: SVG 図解（登場プレイヤー・価値の流れ・カネの流れ）＋「なぜ優れているか」＋代表企業例。
//
// 実装方針（MC-361 の図解標準と整合）:
//  - フロントのみで自己完結（データ・図・スタイルすべて本ファイル内）。API 呼び出しなし。
//  - 配色は Apollo のデザイントークン（var(--mc-*)）のみ。直値 hex を使わない（テーマ両対応）。
//  - SVG は width 100% + viewBox でスケールし、390px 幅でも崩れず読める。
//  - 価値の流れ = 実線（アクセント色）、カネの流れ = 破線（琥珀色）。各図に凡例を付ける。
//  - 各図に role="img" + aria-label（figure + figcaption でも補強）。
//  - ソラ WIP（BottomNav.tsx / icons.tsx / devMockupRouter.ts）には触れない。
//    アイコンが必要な箇所は絵文字 or 本ファイル内のインライン SVG で賄う。
import type { ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader';

// ─── デザイントークン参照（直値 hex を書かないための定数）────────────────────
const C = {
  text: 'var(--mc-text)',
  textMuted: 'var(--mc-text-muted)',
  textFaint: 'var(--mc-text-faint)',
  accent: 'var(--mc-accent)',
  border: 'var(--mc-border)',
  surface: 'var(--mc-surface)',
  surface2: 'var(--mc-surface-2)',
  bg: 'var(--mc-bg)',
  /** カネの流れ（琥珀色。価値=青との対比で一目で区別できる）。 */
  money: 'var(--mc-idle)',
} as const;

// ─── 図解の型 ────────────────────────────────────────────────────────────────
/** 登場プレイヤーの箱。 */
interface DiagramNode {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  /** plain=通常 / accent=主役 / faint=薄く（中抜きされる仲介者など） / container=外枠（社内一気通貫など） */
  tone?: 'plain' | 'accent' | 'faint' | 'container';
}
/** 矢印。value=価値の流れ（実線） / money=カネの流れ（破線）。 */
interface DiagramEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'value' | 'money';
  label?: string;
  /** ラベル位置（省略時は線分の中点の少し上）。 */
  lx?: number;
  ly?: number;
}
/** 図中の補足テキスト（中央揃え）。 */
interface DiagramNote {
  x: number;
  y: number;
  text: string;
}
interface DiagramSpec {
  /** viewBox の幅・高さ。 */
  vb: [number, number];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  notes?: DiagramNote[];
}

/** 「なぜ優れているか」の 1 論点（強調キーワード＋説明）。 */
interface WhyPoint {
  keyword: string;
  text: string;
}

interface BusinessModel {
  /** アンカー用 id（英小文字ハイフン）。 */
  id: string;
  /** 一覧・カード見出し。 */
  title: string;
  /** 絵文字アイコン（icons.tsx を触らないための代替）。 */
  emoji: string;
  /** ひとことで言うと。 */
  tagline: string;
  diagram: DiagramSpec;
  /** 図解の aria-label（スクリーンリーダー向けの言語化）。 */
  diagramAlt: string;
  why: WhyPoint[];
  companiesJp: string[];
  companiesGlobal: string[];
}

// ─── SVG 共通部品 ────────────────────────────────────────────────────────────
// width="100%" + viewBox + style.height:auto で親幅に追従しつつ縦横比を保つ
// （height="auto" を SVG 属性に置くと "Expected length" 警告になるため CSS で制御）。
const svgProps = (vbW: number, vbH: number) => ({
  viewBox: `0 0 ${vbW} ${vbH}`,
  width: '100%',
  style: { display: 'block', maxWidth: '100%', height: 'auto' as const },
  preserveAspectRatio: 'xMidYMid meet',
  'aria-hidden': true as const,
});

/** 矢印マーカー定義。図ごとに id を分けて重複を避ける（value=青 / money=琥珀）。 */
function ArrowDefs({ id }: { id: string }): ReactElement {
  return (
    <defs>
      <marker
        id={`${id}-v`}
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" fill={C.accent} />
      </marker>
      <marker
        id={`${id}-m`}
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" fill={C.money} />
      </marker>
    </defs>
  );
}

/** プレイヤーの箱を 1 つ描く。 */
function NodeBox({ node }: { node: DiagramNode }): ReactElement {
  const { x, y, w, h, label, sub, tone = 'plain' } = node;
  const cx = x + w / 2;
  if (tone === 'container') {
    // 外枠（例: SPA の「社内一気通貫」）。ラベルは左上に置き、中に子ノードが入る。
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={10} fill="none" stroke={C.border} strokeDasharray="6 4" />
        <text x={x + 12} y={y + 20} fill={C.textMuted} fontSize="12" fontWeight="bold">
          {label}
        </text>
      </g>
    );
  }
  const faint = tone === 'faint';
  return (
    <g opacity={faint ? 0.55 : 1}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={tone === 'accent' ? C.surface : C.surface2}
        stroke={tone === 'accent' ? C.accent : C.border}
        strokeWidth={tone === 'accent' ? 1.5 : 1}
        strokeDasharray={faint ? '4 3' : undefined}
      />
      <text
        x={cx}
        y={sub ? y + h / 2 - 4 : y + h / 2 + 4}
        fill={faint ? C.textFaint : C.text}
        fontSize="12"
        fontWeight="bold"
        textAnchor="middle"
      >
        {label}
      </text>
      {sub && (
        <text x={cx} y={y + h / 2 + 13} fill={C.textFaint} fontSize="9.5" textAnchor="middle">
          {sub}
        </text>
      )}
    </g>
  );
}

/** 矢印を 1 本描く（value=実線・青 / money=破線・琥珀）。 */
function EdgeArrow({ edge, markerId }: { edge: DiagramEdge; markerId: string }): ReactElement {
  const { x1, y1, x2, y2, kind, label, lx, ly } = edge;
  const color = kind === 'value' ? C.accent : C.money;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={1.8}
        strokeDasharray={kind === 'money' ? '6 4' : undefined}
        markerEnd={`url(#${markerId}-${kind === 'value' ? 'v' : 'm'})`}
      />
      {label && (
        <text
          x={lx ?? (x1 + x2) / 2}
          y={ly ?? (y1 + y2) / 2 - 6}
          fill={kind === 'value' ? C.textMuted : C.money}
          fontSize="10"
          textAnchor="middle"
        >
          {label}
        </text>
      )}
    </g>
  );
}

/** 図解本体（枠・キャプション・凡例つき）。 */
function ModelDiagram({ model }: { model: BusinessModel }): ReactElement {
  const { vb, nodes, edges, notes } = model.diagram;
  const markerId = `bm-arrow-${model.id}`;
  return (
    <figure className="my-0 rounded-lg border border-border bg-surface p-3">
      <div className="w-full overflow-hidden" role="img" aria-label={model.diagramAlt}>
        <svg {...svgProps(vb[0], vb[1])}>
          <ArrowDefs id={markerId} />
          {nodes.map((n, i) => (
            <NodeBox key={i} node={n} />
          ))}
          {edges.map((e, i) => (
            <EdgeArrow key={i} edge={e} markerId={markerId} />
          ))}
          {(notes ?? []).map((n, i) => (
            <text key={i} x={n.x} y={n.y} fill={C.textFaint} fontSize="10" textAnchor="middle">
              {n.text}
            </text>
          ))}
        </svg>
      </div>
      {/* 凡例（全図共通）。 */}
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[10px] text-text-faint">
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden>
            <line x1="0" y1="4" x2="20" y2="4" stroke={C.accent} strokeWidth="2" />
            <path d="M18,0 L26,4 L18,8 z" fill={C.accent} />
          </svg>
          価値の流れ（商品・サービス・情報）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden>
            <line x1="0" y1="4" x2="20" y2="4" stroke={C.money} strokeWidth="2" strokeDasharray="4 3" />
            <path d="M18,0 L26,4 L18,8 z" fill={C.money} />
          </svg>
          カネの流れ（支払い・手数料）
        </span>
      </figcaption>
    </figure>
  );
}

// ─── 12 モデルのデータ（図解座標つき）────────────────────────────────────────
const MODELS: BusinessModel[] = [
  // 1. サブスクリプション ────────────────────────────────────────────────────
  {
    id: 'subscription',
    title: 'サブスクリプション',
    emoji: '🔁',
    tagline: '売り切りではなく「継続利用の権利」を定額で売り、毎月収益が積み上がるストック型モデル。',
    diagram: {
      vb: [620, 210],
      nodes: [
        { x: 40, y: 70, w: 170, h: 64, label: '企業', sub: 'サービス提供者', tone: 'accent' },
        { x: 410, y: 70, w: 170, h: 64, label: '顧客', sub: '会員・契約者' },
      ],
      edges: [
        { x1: 210, y1: 88, x2: 410, y2: 88, kind: 'value', label: '継続的なサービス提供・アップデート', lx: 310, ly: 78 },
        { x1: 410, y1: 118, x2: 210, y2: 118, kind: 'money', label: '月額・年額の定額課金（自動継続）', lx: 310, ly: 138 },
      ],
      notes: [{ x: 310, y: 185, text: '解約されない限り、毎月の収益が自動で積み上がる（ストック型収益）' }],
    },
    diagramAlt:
      '企業から顧客へ継続的なサービス提供の実線矢印、顧客から企業へ月額・年額の定額課金の破線矢印が往復する図。解約されない限り収益が積み上がるストック型であることを示す。',
    why: [
      { keyword: '収益の予測可能性', text: '来月の売上がほぼ確定するため、先行投資・開発計画が立てやすい。' },
      { keyword: 'スイッチングコスト', text: '使い込むほどデータや習慣が蓄積し、他社への乗り換えが面倒になる。' },
      { keyword: 'LTV の最大化', text: '1 回の販売で終わらず、解約されない限り顧客生涯価値が伸び続ける。' },
    ],
    companiesJp: ['ソニー（PlayStation Plus）', 'サイボウズ', 'freee'],
    companiesGlobal: ['Netflix', 'Spotify', 'Adobe'],
  },
  // 2. フリーミアム ──────────────────────────────────────────────────────────
  {
    id: 'freemium',
    title: 'フリーミアム',
    emoji: '🎁',
    tagline: '基本機能を無料で大量にばらまき、数%の熱心なユーザーの課金で全体を支えるモデル。',
    diagram: {
      vb: [620, 270],
      nodes: [
        { x: 40, y: 100, w: 160, h: 70, label: '企業', tone: 'accent' },
        { x: 410, y: 30, w: 170, h: 56, label: '無料ユーザー', sub: '大多数（宣伝役にもなる）' },
        { x: 410, y: 180, w: 170, h: 56, label: '有料ユーザー', sub: '少数（数%）' },
      ],
      edges: [
        { x1: 200, y1: 115, x2: 410, y2: 58, kind: 'value', label: '無料版を広く提供', lx: 295, ly: 72 },
        { x1: 200, y1: 145, x2: 410, y2: 200, kind: 'value', label: '有料版（上位機能）', lx: 275, ly: 190 },
        { x1: 495, y1: 86, x2: 495, y2: 180, kind: 'value', label: '' },
        { x1: 415, y1: 222, x2: 205, y2: 162, kind: 'money', label: '課金', lx: 330, ly: 225 },
      ],
      notes: [
        { x: 545, y: 137, text: '数%が転換' },
        { x: 310, y: 258, text: '無料ユーザーの獲得コストはほぼゼロ。母数が大きいほど課金者も増える' },
      ],
    },
    diagramAlt:
      '企業が無料版を大多数の無料ユーザーへ、有料版を少数の有料ユーザーへ提供し、無料ユーザーの数%が有料へ転換、有料ユーザーからの課金が企業へ戻る図。',
    why: [
      { keyword: '獲得コストほぼゼロ', text: 'デジタル製品は追加 1 ユーザーのコストが極小。無料で母数を最大化できる。' },
      { keyword: '口コミの増幅', text: '無料ユーザー自身が宣伝役になり、広告費をかけずに広がる。' },
      { keyword: '体験してから課金', text: '価値を実感した人だけが払うため、転換後の解約率が低い。' },
    ],
    companiesJp: ['LINE', 'クックパッド', 'Chatwork'],
    companiesGlobal: ['Dropbox', 'Zoom', 'Canva'],
  },
  // 3. プラットフォーム（両面市場）───────────────────────────────────────────
  {
    id: 'platform',
    title: 'プラットフォーム（両面市場）',
    emoji: '🌉',
    tagline: '性質の異なる 2 つの利用者グループを仲介し、双方が増えるほど価値が増す「場」を提供する。',
    diagram: {
      vb: [640, 250],
      nodes: [
        { x: 20, y: 95, w: 150, h: 64, label: '消費者側', sub: '利用者・買い手' },
        { x: 245, y: 95, w: 150, h: 64, label: 'プラットフォーム', tone: 'accent' },
        { x: 470, y: 95, w: 150, h: 64, label: '事業者側', sub: '売り手・広告主' },
      ],
      edges: [
        { x1: 170, y1: 110, x2: 245, y2: 110, kind: 'value', label: '参加・利用', lx: 207, ly: 100 },
        { x1: 245, y1: 128, x2: 170, y2: 128, kind: 'value', label: 'マッチング', lx: 207, ly: 143 },
        { x1: 470, y1: 110, x2: 395, y2: 110, kind: 'value', label: '出品・出稿', lx: 432, ly: 100 },
        { x1: 395, y1: 128, x2: 470, y2: 128, kind: 'value', label: '顧客リーチ', lx: 432, ly: 143 },
        { x1: 470, y1: 148, x2: 395, y2: 148, kind: 'money', label: '手数料・広告費', lx: 432, ly: 165 },
      ],
      notes: [{ x: 320, y: 215, text: '参加者が増えるほど両側の価値が増える（ネットワーク効果）→ 勝者総取りになりやすい' }],
    },
    diagramAlt:
      '中央のプラットフォームが左の消費者側と右の事業者側を仲介する図。消費者は参加・利用、事業者は出品・出稿し、プラットフォームは双方をマッチングして事業者側から手数料・広告費を得る。',
    why: [
      { keyword: 'ネットワーク効果', text: '利用者が増えるほど事業者にとっての価値が増し、その逆も起きる好循環。' },
      { keyword: '勝者総取り', text: '一度先頭に立つと双方が集まり続け、後発が追いつきにくい。' },
      { keyword: '在庫・製造リスクなし', text: '自らモノを作らず「場」の提供に徹するため、限界費用が小さい。' },
    ],
    companiesJp: ['リクルート（ホットペッパー等）', 'LINEヤフー', 'クックパッド'],
    companiesGlobal: ['Google', 'Apple（App Store）', 'Visa'],
  },
  // 4. 替え刃モデル ──────────────────────────────────────────────────────────
  {
    id: 'razor-blade',
    title: '替え刃モデル（消耗品モデル）',
    emoji: '🪒',
    tagline: '本体を安く売って普及させ、繰り返し買う消耗品の高いマージンで長く稼ぐ。',
    diagram: {
      vb: [620, 230],
      nodes: [
        { x: 40, y: 70, w: 170, h: 75, label: '企業', tone: 'accent' },
        { x: 410, y: 70, w: 170, h: 75, label: '顧客', sub: '本体の保有者' },
      ],
      edges: [
        { x1: 210, y1: 86, x2: 410, y2: 86, kind: 'value', label: '本体を安く販売（例: プリンタ・カミソリ）', lx: 310, ly: 76 },
        { x1: 210, y1: 110, x2: 410, y2: 110, kind: 'value', label: '専用消耗品（高マージン）', lx: 310, ly: 102 },
        { x1: 410, y1: 132, x2: 210, y2: 132, kind: 'money', label: '消耗品を繰り返し購入', lx: 310, ly: 150 },
      ],
      notes: [{ x: 310, y: 200, text: '本体の普及台数が、そのまま将来の消耗品収益になる' }],
    },
    diagramAlt:
      '企業が顧客へ本体を安く販売し、専用消耗品を継続販売する実線矢印と、顧客が消耗品を繰り返し購入する破線矢印の図。本体の普及台数が将来の消耗品収益になることを示す。',
    why: [
      { keyword: '囲い込み', text: '専用設計の消耗品しか使えないため、本体を買った顧客は自社から買い続ける。' },
      { keyword: '参入障壁の逆転', text: '本体は赤字覚悟の安値で競合を寄せ付けず、利益は消耗品で回収する。' },
      { keyword: '継続収益化', text: '売り切りに見えて実態はストック型。普及台数 × 消耗頻度で収益が読める。' },
    ],
    companiesJp: ['キヤノン', '任天堂（本体とソフト）', 'タカラトミー（ゾイド等の拡張）'],
    companiesGlobal: ['Gillette', 'Nespresso', 'HP'],
  },
  // 5. 広告モデル ────────────────────────────────────────────────────────────
  {
    id: 'advertising',
    title: '広告モデル',
    emoji: '📺',
    tagline: 'ユーザーには無料でコンテンツを配り、集まった「注目」を広告主に販売する三者構造。',
    diagram: {
      vb: [620, 285],
      nodes: [
        { x: 225, y: 25, w: 170, h: 60, label: 'メディア企業', tone: 'accent' },
        { x: 40, y: 180, w: 170, h: 60, label: 'ユーザー', sub: '視聴者・読者' },
        { x: 410, y: 180, w: 170, h: 60, label: '広告主' },
      ],
      edges: [
        { x1: 250, y1: 85, x2: 118, y2: 180, kind: 'value', label: '無料コンテンツ', lx: 128, ly: 128 },
        { x1: 152, y1: 180, x2: 285, y2: 85, kind: 'value', label: '注目・利用時間', lx: 262, ly: 145 },
        { x1: 350, y1: 85, x2: 462, y2: 180, kind: 'value', label: '広告枠・リーチ', lx: 362, ly: 128 },
        { x1: 495, y1: 180, x2: 382, y2: 85, kind: 'money', label: '広告費', lx: 490, ly: 145 },
      ],
      notes: [{ x: 310, y: 270, text: 'ユーザーの「注目（アテンション）」を集めて広告主に販売する。ユーザー数=商品の在庫' }],
    },
    diagramAlt:
      '上のメディア企業が左下のユーザーに無料コンテンツを提供して注目と利用時間を集め、右下の広告主へ広告枠とリーチを販売し広告費を得る三角形の図。',
    why: [
      { keyword: '無料による圧倒的な集客', text: '価格ゼロは最強の集客装置。ユーザー数が広告在庫として資産になる。' },
      { keyword: '二段階の収益化', text: 'ユーザーから直接取らないため利用を最大化でき、収益は広告主から得る。' },
      { keyword: 'データによる高単価化', text: '行動データが貯まるほど広告の精度が上がり、広告単価も上がる。' },
    ],
    companiesJp: ['日本テレビ', 'LINEヤフー（Yahoo! JAPAN）', 'ABEMA'],
    companiesGlobal: ['Google（検索広告）', 'Meta', 'YouTube'],
  },
  // 6. マーケットプレイス手数料 ─────────────────────────────────────────────
  {
    id: 'marketplace',
    title: 'マーケットプレイス手数料',
    emoji: '🏪',
    tagline: '売り手と買い手の取引の場を提供し、在庫を持たずに取引額の一定率を手数料として得る。',
    diagram: {
      vb: [640, 250],
      nodes: [
        { x: 20, y: 95, w: 150, h: 64, label: '売り手', sub: '出品者' },
        { x: 245, y: 95, w: 150, h: 64, label: 'マーケットプレイス', tone: 'accent' },
        { x: 470, y: 95, w: 150, h: 64, label: '買い手' },
      ],
      edges: [
        { x1: 170, y1: 112, x2: 245, y2: 112, kind: 'value', label: '出品', lx: 207, ly: 102 },
        { x1: 395, y1: 112, x2: 470, y2: 112, kind: 'value', label: '商品・信頼', lx: 432, ly: 102 },
        { x1: 470, y1: 140, x2: 395, y2: 140, kind: 'money', label: '代金', lx: 432, ly: 157 },
        { x1: 245, y1: 140, x2: 170, y2: 140, kind: 'money', label: '代金 − 手数料', lx: 207, ly: 157 },
      ],
      notes: [{ x: 320, y: 215, text: '取引額の一定率（例: 10%）を徴収。在庫リスクゼロで流通総額とともに収益が伸びる' }],
    },
    diagramAlt:
      '売り手がマーケットプレイスへ出品し、買い手へ商品と信頼が届く実線矢印、買い手の代金がプラットフォームを経由して手数料を差し引かれ売り手へ渡る破線矢印の図。',
    why: [
      { keyword: '在庫リスクゼロ', text: '商品を仕入れないため、売れ残りの損失を負わずに流通総額から稼げる。' },
      { keyword: '取引とともに自動成長', text: '手数料収入は流通総額に比例。市場が伸びれば自動的に収益も伸びる。' },
      { keyword: '信頼のインフラ化', text: '決済・評価・補償を握ることで、当事者同士の直接取引より安全な場になる。' },
    ],
    companiesJp: ['メルカリ', '楽天市場', 'BASE'],
    companiesGlobal: ['Amazonマーケットプレイス', 'eBay', 'Booking.com'],
  },
  // 7. SPA（製造小売）───────────────────────────────────────────────────────
  {
    id: 'spa',
    title: 'SPA（製造小売・ユニクロ型）',
    emoji: '🏭',
    tagline: '企画から販売までを 1 社で貫き、中間マージンを排除して「高品質 × 低価格」を両立する。',
    diagram: {
      vb: [640, 260],
      nodes: [
        { x: 20, y: 60, w: 420, h: 120, label: '企業（一気通貫で自社運営）', tone: 'container' },
        { x: 40, y: 108, w: 80, h: 52, label: '企画' },
        { x: 140, y: 108, w: 80, h: 52, label: '製造' },
        { x: 240, y: 108, w: 80, h: 52, label: '物流' },
        { x: 340, y: 108, w: 80, h: 52, label: '販売', tone: 'accent' },
        { x: 500, y: 104, w: 120, h: 60, label: '顧客' },
      ],
      edges: [
        { x1: 120, y1: 134, x2: 140, y2: 134, kind: 'value' },
        { x1: 220, y1: 134, x2: 240, y2: 134, kind: 'value' },
        { x1: 320, y1: 134, x2: 340, y2: 134, kind: 'value' },
        { x1: 440, y1: 122, x2: 500, y2: 122, kind: 'value', label: '商品', lx: 470, ly: 112 },
        { x1: 500, y1: 146, x2: 440, y2: 146, kind: 'money', label: '代金', lx: 470, ly: 163 },
        { x1: 555, y1: 174, x2: 90, y2: 190, kind: 'value', label: '売れ行きデータを企画へ即フィードバック', lx: 320, ly: 205 },
      ],
      notes: [{ x: 320, y: 240, text: '中間業者のマージンが消え、需要データが直接企画に返る → 高利益率・低在庫' }],
    },
    diagramAlt:
      '企画・製造・物流・販売の 4 工程を 1 つの企業の枠内で直列につなぎ、販売から顧客へ商品、顧客から代金が戻る図。売れ行きデータが企画へ即フィードバックされることを示す。',
    why: [
      { keyword: '中間マージン排除', text: '卸・仲介を通さないため、同じ売価でも利益率が高い（または安く売れる）。' },
      { keyword: '需要と供給の直結', text: '店頭の売れ行きが直接企画に返り、欠品と売れ残りを最小化できる。' },
      { keyword: '規模の経済', text: '素材の大量一括調達と自社工場稼働で、単価が下がり続ける。' },
    ],
    companiesJp: ['ユニクロ（ファーストリテイリング）', 'ニトリ', '無印良品'],
    companiesGlobal: ['ZARA（Inditex）', 'H&M', 'IKEA'],
  },
  // 8. ライセンスモデル ─────────────────────────────────────────────────────
  {
    id: 'license',
    title: 'ライセンスモデル',
    emoji: '📜',
    tagline: '一度つくった知的財産（ブランド・特許・キャラクター）の使用権を、多数の企業に貸して稼ぐ。',
    diagram: {
      vb: [640, 285],
      nodes: [
        { x: 30, y: 108, w: 175, h: 72, label: '権利保有企業', sub: 'ブランド・特許・IP', tone: 'accent' },
        { x: 430, y: 25, w: 180, h: 50, label: '契約企業A', sub: '例: 玩具メーカー' },
        { x: 430, y: 118, w: 180, h: 50, label: '契約企業B', sub: '例: アパレル' },
        { x: 430, y: 210, w: 180, h: 50, label: '契約企業C', sub: '例: 食品メーカー' },
      ],
      edges: [
        { x1: 205, y1: 122, x2: 430, y2: 45, kind: 'value' },
        { x1: 205, y1: 138, x2: 430, y2: 138, kind: 'value', label: '使用権の許諾（ライセンス）', lx: 315, ly: 128 },
        { x1: 205, y1: 155, x2: 430, y2: 232, kind: 'value' },
        { x1: 430, y1: 160, x2: 205, y2: 172, kind: 'money', label: 'ロイヤリティ（売上の数%）', lx: 315, ly: 188 },
      ],
      notes: [{ x: 320, y: 272, text: '一度つくった IP は追加コストほぼゼロで何社にでも貸せる（限界費用ゼロの資産）' }],
    },
    diagramAlt:
      '権利保有企業が複数の契約企業へ使用権を許諾する実線矢印と、各社から売上の数%のロイヤリティが戻る破線矢印の図。IP は追加コストほぼゼロで何社にでも貸せることを示す。',
    why: [
      { keyword: '限界費用ゼロ', text: '同じ IP を何社に貸しても追加コストがほぼゼロ。契約数だけ利益が増える。' },
      { keyword: '他人の資本で拡大', text: '製造・販売・在庫のリスクはすべてライセンシー側。自社は身軽なまま広がる。' },
      { keyword: '法的な独占', text: '特許・商標で守られた権利は模倣できず、長期の価格決定力を持つ。' },
    ],
    companiesJp: ['サンリオ', '任天堂（キャラクターIP）', '東映アニメーション'],
    companiesGlobal: ['Disney', 'ARM', 'Qualcomm'],
  },
  // 9. D2C ─────────────────────────────────────────────────────────────────
  {
    id: 'd2c',
    title: 'D2C（Direct to Consumer）',
    emoji: '📦',
    tagline: 'メーカーが卸・小売を通さず、自社 EC と SNS で顧客に直接売り、データも利益も直接得る。',
    diagram: {
      vb: [620, 275],
      nodes: [
        { x: 40, y: 75, w: 170, h: 64, label: 'メーカー', sub: 'ブランド保有', tone: 'accent' },
        { x: 410, y: 75, w: 170, h: 64, label: '顧客', sub: 'ファン・会員' },
        { x: 235, y: 185, w: 150, h: 52, label: '卸・小売・モール', sub: '経由しない', tone: 'faint' },
      ],
      edges: [
        { x1: 210, y1: 92, x2: 410, y2: 92, kind: 'value', label: '自社EC・SNSで直接販売', lx: 310, ly: 82 },
        { x1: 410, y1: 112, x2: 210, y2: 112, kind: 'money', label: '代金（中間マージンなし）', lx: 310, ly: 130 },
        { x1: 435, y1: 139, x2: 240, y2: 154, kind: 'value', label: '声・購買データが直接届く', lx: 330, ly: 162 },
      ],
      notes: [{ x: 310, y: 262, text: '顧客データを自社で握り、商品開発・ファンづくりに直結させる' }],
    },
    diagramAlt:
      'メーカーが自社 EC・SNS で顧客に直接販売し、中間マージンなしの代金と顧客の声・購買データが直接戻る図。卸・小売・モールの箱は薄く描かれ経由しないことを示す。',
    why: [
      { keyword: '顧客データの独占', text: '誰が・いつ・何を買ったかを自社で把握でき、商品開発と CRM に直結する。' },
      { keyword: '高い粗利率', text: '中間流通のマージンが消え、同じ売価でも利益が大きく残る。' },
      { keyword: 'ブランドの世界観', text: '売り場を自社で握るため、価格競争に巻き込まれず世界観で選ばれる。' },
    ],
    companiesJp: ['ベースフード', 'BULK HOMME', 'FABRIC TOKYO'],
    companiesGlobal: ['Warby Parker', 'Glossier', 'Allbirds'],
  },
  // 10. シェアリングエコノミー ──────────────────────────────────────────────
  {
    id: 'sharing',
    title: 'シェアリングエコノミー',
    emoji: '🚗',
    tagline: '個人の遊休資産（車・部屋・スキル）を借りたい人につなぎ、自社は資産を持たずに稼ぐ。',
    diagram: {
      vb: [640, 250],
      nodes: [
        { x: 20, y: 95, w: 150, h: 64, label: '提供者', sub: '遊休資産を持つ個人' },
        { x: 245, y: 95, w: 150, h: 64, label: 'プラットフォーム', tone: 'accent' },
        { x: 470, y: 95, w: 150, h: 64, label: '利用者' },
      ],
      edges: [
        { x1: 170, y1: 112, x2: 245, y2: 112, kind: 'value', label: '資産・スキル登録', lx: 207, ly: 102 },
        { x1: 395, y1: 112, x2: 470, y2: 112, kind: 'value', label: '利用（車・部屋等）', lx: 432, ly: 102 },
        { x1: 470, y1: 140, x2: 395, y2: 140, kind: 'money', label: '利用料', lx: 432, ly: 157 },
        { x1: 245, y1: 140, x2: 170, y2: 140, kind: 'money', label: '報酬（− 手数料）', lx: 207, ly: 157 },
      ],
      notes: [{ x: 320, y: 215, text: '自社で資産を 1 つも持たず、世の中の遊休資産が増えるほど供給が増える' }],
    },
    diagramAlt:
      '遊休資産を持つ提供者がプラットフォームに資産を登録し、利用者が利用する実線矢印と、利用料がプラットフォームを経由し手数料を差し引かれ提供者へ渡る破線矢印の図。',
    why: [
      { keyword: '資産ゼロで供給拡大', text: '車も部屋も持たずに、世界中の遊休資産を自社の「在庫」にできる。' },
      { keyword: '眠る価値の収益化', text: '稼働率数%の資産を市場に出すため、既存業者より安く提供できる。' },
      { keyword: '相互評価による信頼', text: 'レビューの蓄積が参入障壁になり、後発は信頼データで追いつけない。' },
    ],
    companiesJp: ['タイムズカー', 'akippa', 'スペースマーケット'],
    companiesGlobal: ['Uber', 'Airbnb', 'Turo'],
  },
  // 11. データ活用モデル ─────────────────────────────────────────────────────
  {
    id: 'data',
    title: 'データ活用モデル',
    emoji: '📊',
    tagline: 'サービスは安く（または無料で）配り、集まる行動データを精度と収益の源泉にする。',
    diagram: {
      vb: [620, 295],
      nodes: [
        { x: 40, y: 115, w: 175, h: 72, label: '企業', sub: 'データで改善し続ける', tone: 'accent' },
        { x: 410, y: 35, w: 170, h: 56, label: 'ユーザー' },
        { x: 410, y: 200, w: 170, h: 56, label: '広告主・パートナー' },
      ],
      edges: [
        { x1: 215, y1: 130, x2: 410, y2: 60, kind: 'value', label: '無料・低価格のサービス', lx: 295, ly: 75 },
        { x1: 410, y1: 80, x2: 215, y2: 150, kind: 'value', label: '行動データ・利用ログ', lx: 330, ly: 132 },
        { x1: 215, y1: 168, x2: 410, y2: 218, kind: 'value', label: '精度の高いターゲティング・知見', lx: 285, ly: 208 },
        { x1: 415, y1: 240, x2: 220, y2: 185, kind: 'money', label: '広告収入・データ由来の収益', lx: 340, ly: 250 },
      ],
      notes: [{ x: 310, y: 283, text: 'データが増える → サービスが賢くなる → さらにユーザーとデータが増える好循環' }],
    },
    diagramAlt:
      '企業がユーザーへ無料・低価格のサービスを提供して行動データを集め、そのデータで磨いたターゲティングを広告主・パートナーへ提供し収益を得る循環の図。',
    why: [
      { keyword: 'データの複利効果', text: 'データが増えるほどサービスが賢くなり、さらに利用者が増える自己強化ループ。' },
      { keyword: '模倣困難な資産', text: '機能はコピーできても、蓄積された数十億件のデータはコピーできない。' },
      { keyword: '収益源の多重化', text: '同じデータを広告・予測・改善など複数の形で何度でも収益化できる。' },
    ],
    companiesJp: ['リクルート', 'CCC（Vポイント）', 'トヨタ（コネクテッドカー）'],
    companiesGlobal: ['Google', 'Amazon', 'Tesla'],
  },
  // 12. フランチャイズ ──────────────────────────────────────────────────────
  {
    id: 'franchise',
    title: 'フランチャイズ',
    emoji: '🏬',
    tagline: 'ブランドと成功ノウハウを加盟店に貸し、他人の資本と労働力で店舗網を一気に広げる。',
    diagram: {
      vb: [640, 290],
      nodes: [
        { x: 30, y: 112, w: 160, h: 70, label: '本部', sub: 'ブランド・ノウハウ', tone: 'accent' },
        { x: 330, y: 28, w: 150, h: 50, label: '加盟店A' },
        { x: 330, y: 122, w: 150, h: 50, label: '加盟店B' },
        { x: 330, y: 216, w: 150, h: 50, label: '加盟店C' },
        { x: 545, y: 120, w: 75, h: 54, label: '顧客' },
      ],
      edges: [
        { x1: 190, y1: 126, x2: 330, y2: 48, kind: 'value' },
        { x1: 190, y1: 142, x2: 330, y2: 142, kind: 'value', label: 'ブランド・ノウハウ・仕入網', lx: 258, ly: 110 },
        { x1: 190, y1: 158, x2: 330, y2: 238, kind: 'value' },
        { x1: 330, y1: 162, x2: 190, y2: 172, kind: 'money', label: '加盟金・ロイヤリティ', lx: 258, ly: 190 },
        { x1: 480, y1: 138, x2: 545, y2: 138, kind: 'value', label: '商品', lx: 512, ly: 128 },
        { x1: 545, y1: 158, x2: 480, y2: 158, kind: 'money', label: '代金', lx: 512, ly: 175 },
      ],
      notes: [{ x: 320, y: 280, text: '店舗投資と人件費は加盟店持ち。本部は低リスクのまま店舗網と収益が拡大する' }],
    },
    diagramAlt:
      '本部が複数の加盟店へブランド・ノウハウ・仕入網を提供する実線矢印、各加盟店から加盟金・ロイヤリティが戻る破線矢印、加盟店と顧客の間の商品と代金の図。',
    why: [
      { keyword: '他人の資本で拡大', text: '店舗投資・人件費は加盟店側の負担。本部は低リスクで急速に店舗網を広げられる。' },
      { keyword: 'ロイヤリティのストック性', text: '加盟店が営業する限り、売上連動の収益が本部に入り続ける。' },
      { keyword: '規模が規模を呼ぶ', text: '店舗数が増えるほど仕入・物流・広告の効率が上がり、加盟の魅力も増す。' },
    ],
    companiesJp: ['セブン-イレブン', 'ワークマン', 'カーブス'],
    companiesGlobal: ['マクドナルド', 'サブウェイ', 'KFC'],
  },
];

// ─── モデルカード ────────────────────────────────────────────────────────────
function ModelCard({ model, index }: { model: BusinessModel; index: number }): ReactElement {
  return (
    <section
      id={`bm-${model.id}`}
      className="scroll-mt-4 rounded-xl border border-border bg-surface p-4 md:p-5"
      aria-label={model.title}
    >
      {/* 見出し */}
      <header className="mb-2 flex items-start gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg"
          style={{ background: 'var(--mc-surface-2)' }}
          aria-hidden
        >
          {model.emoji}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-text">
            <span className="mr-1.5 text-text-faint">{String(index + 1).padStart(2, '0')}</span>
            {model.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{model.tagline}</p>
        </div>
      </header>

      {/* 図解 */}
      <ModelDiagram model={model} />

      {/* なぜ優れているか */}
      <div className="mt-3">
        <h3 className="mb-1.5 text-xs font-bold text-text">💪 なぜ優れているか</h3>
        <ul className="flex flex-col gap-1.5">
          {model.why.map((p) => (
            <li key={p.keyword} className="flex items-start gap-2 text-xs leading-relaxed text-text-muted">
              <span
                className="mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
                style={{ color: 'var(--mc-accent)', background: 'var(--mc-callout-info-bg)' }}
              >
                {p.keyword}
              </span>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 代表企業 */}
      <div className="mt-3 border-t border-border pt-2.5">
        <h3 className="mb-1.5 text-xs font-bold text-text">🏢 代表企業</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-text-faint">日本</span>
          {model.companiesJp.map((c) => (
            <span
              key={c}
              className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted"
            >
              {c}
            </span>
          ))}
          <span className="ml-1 text-[10px] font-semibold text-text-faint">世界</span>
          {model.companiesGlobal.map((c) => (
            <span
              key={c}
              className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── ページ本体 ──────────────────────────────────────────────────────────────
export default function BusinessModels(): ReactElement {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="ビジネスモデル図鑑" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 md:p-6">
          {/* イントロ */}
          <header>
            <h1 className="text-base font-bold text-text">📖 ビジネスモデル図鑑</h1>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              世の中の優れたビジネスモデル 12 種を「登場プレイヤー・価値の流れ・カネの流れ」の 1
              枚図解でまとめたカタログです。実線（青）が価値の流れ、破線（琥珀）がカネの流れを表します。
            </p>
          </header>

          {/* 目次（アンカーで各カードへジャンプ） */}
          <nav aria-label="モデル一覧" className="rounded-xl border border-border bg-surface p-3">
            <div className="flex flex-wrap gap-1.5">
              {MODELS.map((m, i) => (
                <a
                  key={m.id}
                  href={`#bm-${m.id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:border-accent hover:text-text"
                >
                  <span aria-hidden>{m.emoji}</span>
                  <span className="text-text-faint">{String(i + 1).padStart(2, '0')}</span>
                  {m.title}
                </a>
              ))}
            </div>
          </nav>

          {/* 12 モデルのカード */}
          {MODELS.map((m, i) => (
            <ModelCard key={m.id} model={m} index={i} />
          ))}

          <p className="pb-4 text-center text-[10px] text-text-faint">
            全 {MODELS.length} モデル · ビジネスモデル図鑑（MC-363）
          </p>
        </div>
      </div>
    </div>
  );
}
