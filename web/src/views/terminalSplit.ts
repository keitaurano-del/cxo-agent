// ターミナル分割レイアウトのエンジン（MC-156 作り直し）。
//
// ブラウザのウィンドウを並べる感覚で、ターミナルの配置と大きさを直感的に変える。
// 旧実装（固定 CSS グリッド + splitCount 1〜4）は paneAssign が TERMINAL_TABS の id
// （1/3/4/5）でなく [1,2,3,4] を既定にしていたため、存在しない id=2 を割り当てて
// 「2分割を押しても 1 枚しか出ない」不具合になっていた。本エンジンは
//   - レイアウトを「分割ツリー」で表現（row=横並び / col=縦並び）
//   - 各ペイン（leaf）の矩形を % で算出 → iframe を絶対配置（iframe は常時 mount＝セッション保持）
//   - ディバイダのドラッグでサイズ比を連続変更し localStorage に永続化
// する。割当はペイン index → ターミナル id の配列で別管理する。

// 分割ツリーのノード。
//   - leaf: 1 ペイン。slot は表示順の index（0 始まり）。
//   - row : 子を横に並べる（左右、ドラッグは縦ディバイダ＝幅調整）。
//   - col : 子を縦に並べる（上下、ドラッグは横ディバイダ＝高さ調整）。
export type SplitNode =
  | { type: 'leaf'; slot: number }
  | { type: 'row'; children: SplitNode[]; sizes: number[] }
  | { type: 'col'; children: SplitNode[]; sizes: number[] };

export interface LayoutDef {
  id: LayoutId;
  label: string;
  paneCount: number;
  /** 既定のツリー（sizes は均等）。永続化サイズが無いときに使う。 */
  build: () => SplitNode;
}

export type LayoutId = 'single' | 'cols2' | 'cols3' | 'rows2' | 'rows3' | 'grid2x2';

/** 子 n 個の均等サイズ配列（合計 100）。 */
function even(n: number): number[] {
  return Array.from({ length: n }, () => 100 / n);
}

// 各レイアウトの既定ツリー定義。slot は 0..paneCount-1。
export const LAYOUTS: Record<LayoutId, LayoutDef> = {
  single: {
    id: 'single',
    label: '単一',
    paneCount: 1,
    build: () => ({ type: 'leaf', slot: 0 }),
  },
  cols2: {
    id: 'cols2',
    label: '横2列',
    paneCount: 2,
    build: () => ({
      type: 'row',
      sizes: even(2),
      children: [
        { type: 'leaf', slot: 0 },
        { type: 'leaf', slot: 1 },
      ],
    }),
  },
  cols3: {
    id: 'cols3',
    label: '横3列',
    paneCount: 3,
    build: () => ({
      type: 'row',
      sizes: even(3),
      children: [
        { type: 'leaf', slot: 0 },
        { type: 'leaf', slot: 1 },
        { type: 'leaf', slot: 2 },
      ],
    }),
  },
  rows2: {
    id: 'rows2',
    label: '縦2段',
    paneCount: 2,
    build: () => ({
      type: 'col',
      sizes: even(2),
      children: [
        { type: 'leaf', slot: 0 },
        { type: 'leaf', slot: 1 },
      ],
    }),
  },
  rows3: {
    id: 'rows3',
    label: '縦3段',
    paneCount: 3,
    build: () => ({
      type: 'col',
      sizes: even(3),
      children: [
        { type: 'leaf', slot: 0 },
        { type: 'leaf', slot: 1 },
        { type: 'leaf', slot: 2 },
      ],
    }),
  },
  grid2x2: {
    id: 'grid2x2',
    label: '2×2',
    paneCount: 4,
    // 上段 row(slot0,slot1) / 下段 row(slot2,slot3) を縦に積む。
    // 外側 col の sizes=上下高さ、各 row の sizes=左右幅。
    build: () => ({
      type: 'col',
      sizes: even(2),
      children: [
        {
          type: 'row',
          sizes: even(2),
          children: [
            { type: 'leaf', slot: 0 },
            { type: 'leaf', slot: 1 },
          ],
        },
        {
          type: 'row',
          sizes: even(2),
          children: [
            { type: 'leaf', slot: 2 },
            { type: 'leaf', slot: 3 },
          ],
        },
      ],
    }),
  },
};

export const LAYOUT_ORDER: LayoutId[] = ['single', 'cols2', 'cols3', 'rows2', 'rows3', 'grid2x2'];

// ペインの矩形（コンテナに対する % 値）。
export interface PaneRect {
  slot: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// ディバイダ（ドラッグハンドル）。orientation=row なら縦線（左右の幅を調整）、
// col なら横線（上下の高さを調整）。path はツリー内の親ノードを指す（sizes 更新用）。
export interface Divider {
  id: string;
  orientation: 'row' | 'col';
  /** コンテナに対する位置・サイズ（%）。中心線。 */
  left: number;
  top: number;
  width: number;
  height: number;
  /** ドラッグ対象の親ノードへの path と、その親の sizes 内で左/上側の子 index。 */
  path: number[];
  /** path で示す親の sizes における、ディバイダ左/上側の子の index（index と index+1 を調整）。 */
  beforeIndex: number;
}

const MIN_FRACTION = 8; // 各ペインの最小サイズ（%）。これ以下には縮めない。

/** ツリーを走査し、各 leaf の矩形と全ディバイダを算出する。 */
export function computeLayout(node: SplitNode): { rects: PaneRect[]; dividers: Divider[] } {
  const rects: PaneRect[] = [];
  const dividers: Divider[] = [];

  function walk(n: SplitNode, x: number, y: number, w: number, h: number, path: number[]) {
    if (n.type === 'leaf') {
      rects.push({ slot: n.slot, left: x, top: y, width: w, height: h });
      return;
    }
    const horizontal = n.type === 'row';
    const total = n.sizes.reduce((a, b) => a + b, 0) || 1;
    let offset = 0;
    for (let i = 0; i < n.children.length; i++) {
      const frac = n.sizes[i] / total;
      const childW = horizontal ? w * frac : w;
      const childH = horizontal ? h : h * frac;
      const childX = horizontal ? x + w * (offset / total) : x;
      const childY = horizontal ? y : y + h * (offset / total);
      walk(n.children[i], childX, childY, childW, childH, [...path, i]);

      // 子と子の間にディバイダを置く（最後の子の後ろには置かない）。
      if (i < n.children.length - 1) {
        const cumFrac = (offset + n.sizes[i]) / total;
        if (horizontal) {
          dividers.push({
            id: `${path.join('-')}|${i}|row`,
            orientation: 'row',
            left: x + w * cumFrac,
            top: y,
            width: 0,
            height: h,
            path,
            beforeIndex: i,
          });
        } else {
          dividers.push({
            id: `${path.join('-')}|${i}|col`,
            orientation: 'col',
            left: x,
            top: y + h * cumFrac,
            width: w,
            height: 0,
            path,
            beforeIndex: i,
          });
        }
      }
      offset += n.sizes[i];
    }
  }

  walk(node, 0, 0, 100, 100, []);
  return { rects, dividers };
}

/** path で示す親ノードの sizes を、beforeIndex と beforeIndex+1 の間で deltaPct だけ動かす。
 *  deltaPct はコンテナ全体に対する %（親ノードの占有比で正規化して適用）。新しいツリーを返す。 */
export function resizeAt(
  root: SplitNode,
  path: number[],
  beforeIndex: number,
  deltaPctOfContainer: number,
): SplitNode {
  // path をたどって親ノードの占有比（コンテナ比）を求めつつ、対象ノードを複製更新する。
  function clone(n: SplitNode): SplitNode {
    if (n.type === 'leaf') return { ...n };
    return { ...n, children: n.children.map(clone), sizes: [...n.sizes] };
  }
  const newRoot = clone(root);

  // 親ノードのコンテナ占有比（その軸方向の長さ %）を path から計算。
  let containerSpan = 100;
  let cur: SplitNode = newRoot;
  for (const idx of path) {
    if (cur.type === 'leaf') break;
    const total = cur.sizes.reduce((a, b) => a + b, 0) || 1;
    containerSpan = containerSpan * (cur.sizes[idx] / total);
    cur = cur.children[idx];
  }
  if (cur.type === 'leaf') return newRoot;

  const node = cur;
  const total = node.sizes.reduce((a, b) => a + b, 0) || 1;
  // deltaPctOfContainer をこの親ノードのローカル sizes 単位へ変換。
  const localDelta = (deltaPctOfContainer / containerSpan) * total;
  const a = node.sizes[beforeIndex];
  const b = node.sizes[beforeIndex + 1];
  const minLocal = (MIN_FRACTION / containerSpan) * total;
  let newA = a + localDelta;
  let newB = b - localDelta;
  if (newA < minLocal) {
    newB -= minLocal - newA;
    newA = minLocal;
  }
  if (newB < minLocal) {
    newA -= minLocal - newB;
    newB = minLocal;
  }
  node.sizes[beforeIndex] = newA;
  node.sizes[beforeIndex + 1] = newB;
  return newRoot;
}

/** ツリーの全 sizes を均等化する（ダブルクリック用）。 */
export function equalize(node: SplitNode): SplitNode {
  if (node.type === 'leaf') return { ...node };
  return {
    ...node,
    sizes: even(node.children.length),
    children: node.children.map(equalize),
  };
}

/** ツリーが指定レイアウトの形状（type/子数）に一致するか検証する。
 *  localStorage から復元したツリーが現行レイアウト定義と食い違っていないかの安全チェック。 */
export function matchesShape(node: SplitNode, ref: SplitNode): boolean {
  if (node.type !== ref.type) return false;
  if (node.type === 'leaf') return true;
  if (ref.type === 'leaf') return false;
  if (node.children.length !== ref.children.length) return false;
  if (node.sizes.length !== node.children.length) return false;
  return node.children.every((c, i) => matchesShape(c, (ref as typeof node).children[i]));
}
