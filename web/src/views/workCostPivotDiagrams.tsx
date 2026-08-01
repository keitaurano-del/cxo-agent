// 仕事ページ（/work）「課題管理費の集計」ピボット図解タブ用の SVG 図解。
//
// 既存の workPivotDiagrams.tsx（ECL 残高のクロス集計が例）と同じ作法で、課題管理費（プロジェクトの費用）の
// 集計に特化した図解を React コンポーネント（SVG 群）として実装する。ChatMarkdown（react-markdown）は
// rehype-raw 無しで raw SVG をテキスト化するため Markdown に図を埋め込めない。よって図はこの SVG 群とし、
// Work.tsx 側で説明文（ChatMarkdown）と交互に配置する。
//
// 各定義（C / DiagramFrame / svgProps / ArrowDefs）は既存ファイルから import せず、このファイル内で
// 自己完結させる（別ファイルなので重複定義で衝突しない）。
//
// 描画ルール:
//  - 配色は Apollo のデザイントークン（var(--mc-*)）のみ。直値 hex を使わない（ダーク/ライト両対応）。
//  - 横幅は親に追従（width 100% / height auto・viewBox でスケール）。390px でも崩れず読める。
//  - 各図に role="img" + aria-label を付ける（figure + figcaption でも補強）。
//  - 図中ラベルは中立的な丁寧体。一貫例として「行=費目 × 列=発生月、値=費用合計」を使う。
//  - サンプル列：課題ID/案件/フェーズ/費目/担当/発生月/工数/費用/ステータス（実データに合わせ読み替え可）。
//  - 金額はサンプルで、千円単位（千円）に統一する。

import type { ReactNode } from 'react';

// ─── デザイントークン参照（直値 hex を書かないための定数）────────────────────
const C = {
  text: 'var(--mc-text)',
  textMuted: 'var(--mc-text-muted)',
  textFaint: 'var(--mc-text-faint)',
  accent: 'var(--mc-accent)',
  accentStrong: 'var(--mc-accent-strong)',
  border: 'var(--mc-border)',
  borderStrong: 'var(--mc-border-strong)',
  surface: 'var(--mc-surface)',
  surface2: 'var(--mc-surface-2)',
  surface3: 'var(--mc-surface-3)',
  bg: 'var(--mc-bg)',
  // 費用が偏る箇所を「注意色」で示す（状態色トークン）。
  warn: 'var(--mc-blocked)',
  warnBg: 'var(--mc-blocked-bg)',
  ok: 'var(--mc-active)',
  okBg: 'var(--mc-active-bg)',
} as const;

// ─── 図の外枠（figure + キャプション + 番号バッジ）──────────────────────────
function DiagramFrame({
  step,
  title,
  ariaLabel,
  children,
}: {
  step?: number;
  title: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <figure className="my-3 rounded-lg border border-border bg-surface p-3 md:p-4">
      <figcaption className="mb-2 flex items-center gap-2">
        {step != null && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-bg">
            {step}
          </span>
        )}
        <span className="text-xs font-bold text-text">{title}</span>
      </figcaption>
      <div className="w-full overflow-hidden" role="img" aria-label={ariaLabel}>
        {children}
      </div>
    </figure>
  );
}

// SVG 共通 props（横幅追従・高さ自動）。
// 高さは SVG 属性ではなく CSS（style.height: auto）で制御する。
// width="100%" + viewBox + style.height:auto で親幅に追従しつつ縦横比を保つ。
// （height="auto" を SVG 属性に渡すと "Expected length" 警告になるため属性には置かない）
const svgProps = (vbW: number, vbH: number) => ({
  viewBox: `0 0 ${vbW} ${vbH}`,
  width: '100%',
  style: { display: 'block', maxWidth: '100%', height: 'auto' as const },
  preserveAspectRatio: 'xMidYMid meet',
  'aria-hidden': true as const,
});

// 右向き矢印マーカー定義（各図で id を分けて重複を避ける）。
function ArrowDefs({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" fill={C.accent} />
      </marker>
    </defs>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 図1: 課題管理（費用）一覧（縦長）→ クロス集計表（行=費目 × 列=発生月、値=費用合計）。
//      外注費が特定の月に偏ることが数字で一目で分かる。金額はサンプル（千円）。
// ════════════════════════════════════════════════════════════════════════════
export function CostPivotBeforeAfterDiagram() {
  // 縦長の費用一覧を表す行（ダミーの濃淡バー）。
  const rawRows = Array.from({ length: 14 });
  return (
    <DiagramFrame
      title="ピボットの前後：縦長の費用一覧 → クロス集計表"
      ariaLabel="左に縦長の課題管理（費用）一覧、右向きの矢印を挟んで、右に行が費目（人件費・外注費・ライセンス・経費）、列が発生月（4月・5月・6月）、値が費用合計のクロス集計表。総計行と総計列があり、外注費が 6 月に偏っていることを示しています。金額はサンプルで千円単位です。"
    >
      <svg {...svgProps(600, 320)}>
        <ArrowDefs id="cost-arrow-beforeafter" />

        {/* 左: 費用一覧（縦長のイメージ） */}
        <text x="10" y="16" fill={C.textMuted} fontSize="12" fontWeight="bold">
          課題管理（費用）一覧
        </text>
        <rect x="10" y="24" width="200" height="280" rx="6" fill={C.surface2} stroke={C.border} />
        {/* ヘッダ行 */}
        <rect x="10" y="24" width="200" height="18" rx="6" fill={C.surface3} />
        <text x="20" y="37" fill={C.textMuted} fontSize="8.5">
          費目 / 発生月 / 担当 / 費用 …
        </text>
        {rawRows.map((_, i) => (
          <g key={i}>
            <line
              x1="10"
              y1={48 + i * 18}
              x2="210"
              y2={48 + i * 18}
              stroke={C.border}
              strokeWidth="0.5"
            />
            <rect x="20" y={52 + i * 18} width="40" height="7" rx="2" fill={C.borderStrong} opacity="0.5" />
            <rect x="68" y={52 + i * 18} width="40" height="7" rx="2" fill={C.borderStrong} opacity="0.5" />
            <rect x="116" y={52 + i * 18} width="30" height="7" rx="2" fill={C.borderStrong} opacity="0.5" />
            <rect x="154" y={52 + i * 18} width="46" height="7" rx="2" fill={C.accent} opacity="0.35" />
          </g>
        ))}
        <text x="110" y="300" fill={C.textFaint} fontSize="9" textAnchor="middle">
          ︙ 続く
        </text>

        {/* 矢印 */}
        <line
          x1="222"
          y1="164"
          x2="262"
          y2="164"
          stroke={C.accent}
          strokeWidth="3"
          markerEnd="url(#cost-arrow-beforeafter)"
        />
        <text x="242" y="150" fill={C.accent} fontSize="10" fontWeight="bold" textAnchor="middle">
          集計
        </text>

        {/* 右: クロス集計表 */}
        <text x="278" y="16" fill={C.textMuted} fontSize="12" fontWeight="bold">
          クロス集計（値＝費用合計）
        </text>
        {(() => {
          const ox = 278;
          const oy = 30;
          const colX = [ox, ox + 84, ox + 130, ox + 176, ox + 222]; // 費目 / 4月 / 5月 / 6月 / 総計
          const colW = [84, 46, 46, 46, 56];
          const rowY = [oy, oy + 30, oy + 56, oy + 82, oy + 108, oy + 134]; // ヘッダ / 人件費 / 外注費 / ライセンス / 経費 / 総計
          const rowH = [30, 26, 26, 26, 26, 26];
          const header = ['費目', '4月', '5月', '6月', '総計'];
          // 金額（千円）。外注費の 6 月に偏らせる。
          const data: [string, string, string, string, string][] = [
            ['人件費', '1,200', '1,200', '1,200', '3,600'],
            ['外注費', '300', '500', '2,800', '3,600'],
            ['ライセンス', '—', '600', '—', '600'],
            ['経費', '40', '60', '80', '180'],
            ['総計', '1,540', '2,360', '4,080', '7,980'],
          ];
          const cells: ReactNode[] = [];
          // ヘッダ
          header.forEach((h, c) => {
            cells.push(
              <g key={`h-${c}`}>
                <rect
                  x={colX[c]}
                  y={rowY[0]}
                  width={colW[c]}
                  height={rowH[0]}
                  fill={C.surface3}
                  stroke={C.border}
                />
                <text
                  x={colX[c] + colW[c] / 2}
                  y={rowY[0] + 19}
                  fill={C.text}
                  fontSize={c === 0 ? '10' : '11'}
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {h}
                </text>
              </g>,
            );
          });
          // データ行
          data.forEach((row, r) => {
            const yi = r + 1;
            const isTotal = r === data.length - 1;
            row.forEach((v, c) => {
              // 外注費（r=1）の 6 月列（c=3）を注意色でハイライト。
              const isHot = c === 3 && r === 1;
              const fillBg = isTotal ? C.surface2 : isHot ? C.warnBg : C.surface;
              cells.push(
                <g key={`d-${r}-${c}`}>
                  <rect
                    x={colX[c]}
                    y={rowY[yi]}
                    width={colW[c]}
                    height={rowH[yi]}
                    fill={fillBg}
                    stroke={C.border}
                  />
                  <text
                    x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] - 6}
                    y={rowY[yi] + rowH[yi] / 2 + 4}
                    fill={isHot ? C.warn : isTotal ? C.text : c === 0 ? C.textMuted : C.text}
                    fontSize={c === 0 ? '10' : '10.5'}
                    fontWeight={isTotal || isHot ? 'bold' : 'normal'}
                    textAnchor={c === 0 ? 'start' : 'end'}
                  >
                    {v}
                  </text>
                </g>,
              );
            });
          });
          return cells;
        })()}
        {/* 偏りの注記 */}
        <text x="278" y="200" fill={C.warn} fontSize="9.5">
          ※ 金額は千円（サンプル）。外注費が 6 月に
        </text>
        <text x="278" y="213" fill={C.warn} fontSize="9.5">
          　偏っていることが一目で分かります。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 図2: 「ピボットテーブルのフィールド」ペイン。
//      一覧（費目/担当/フェーズ/発生月/工数/費用/案件）から、費目→行・発生月→列・費用→値 へドラッグ。
//      値に「費用（合計）」、補足で工数・件数も値に置ける旨。
// ════════════════════════════════════════════════════════════════════════════
export function CostPivotFieldPaneDiagram() {
  const fields = ['費目', '担当', 'フェーズ', '発生月', '工数', '費用', '案件'];
  return (
    <DiagramFrame
      step={1}
      title="フィールドの配置：一覧から4つのボックスへドラッグ"
      ariaLabel="ピボットテーブルのフィールドペインの図。上にフィールド一覧（費目・担当・フェーズ・発生月・工数・費用・案件）、下に4つのドロップ先ボックス、フィルター・列・行・値があります。費目を行へ、発生月を列へ、費用を値へドラッグする矢印が描かれ、値には工数や件数も追加で置ける旨が添えられています。"
    >
      <svg {...svgProps(600, 360)}>
        <ArrowDefs id="cost-arrow-fieldpane" />
        <rect x="0" y="0" width="600" height="360" rx="8" fill={C.surface2} stroke={C.border} />
        <text x="14" y="22" fill={C.text} fontSize="12" fontWeight="bold">
          ピボットテーブルのフィールド
        </text>

        {/* フィールド一覧 */}
        <text x="14" y="42" fill={C.textMuted} fontSize="10">
          レポートに追加するフィールド：
        </text>
        {fields.map((f, i) => {
          const used = f === '費目' || f === '発生月' || f === '費用';
          return (
            <g key={f}>
              <rect
                x={14}
                y={50 + i * 24}
                width="200"
                height="20"
                rx="3"
                fill={used ? C.okBg : C.surface}
                stroke={used ? C.ok : C.border}
              />
              <rect x={20} y={56 + i * 24} width="9" height="9" rx="2" fill={used ? C.ok : C.textFaint} />
              <text x={36} y={64 + i * 24} fill={C.text} fontSize="11">
                {f}
              </text>
            </g>
          );
        })}

        {/* ドラッグ矢印（一覧 → 各ボックス） */}
        {/* 費目 → 行 */}
        <path
          d="M214,61 C300,61 300,250 360,250"
          fill="none"
          stroke={C.accent}
          strokeWidth="2"
          strokeDasharray="4 3"
          markerEnd="url(#cost-arrow-fieldpane)"
        />
        {/* 発生月 → 列 */}
        <path
          d="M214,133 C320,133 320,196 360,196"
          fill="none"
          stroke={C.accent}
          strokeWidth="2"
          strokeDasharray="4 3"
          markerEnd="url(#cost-arrow-fieldpane)"
        />
        {/* 費用 → 値 */}
        <path
          d="M214,181 C300,181 300,304 360,304"
          fill="none"
          stroke={C.accent}
          strokeWidth="2"
          strokeDasharray="4 3"
          markerEnd="url(#cost-arrow-fieldpane)"
        />

        {/* 4つのドロップ先ボックス */}
        {(() => {
          const boxes: { label: string; role: string; chip?: string; y: number }[] = [
            { label: 'フィルター', role: '表全体の絞り込み（例：案件）', y: 96 },
            { label: '列', role: '横に並べる項目', chip: '発生月', y: 150 },
            { label: '行', role: '縦に並べる項目', chip: '費目', y: 204 },
            { label: '値', role: '集計する数値', chip: '費用（合計）', y: 258 },
          ];
          return boxes.map((b) => (
            <g key={b.label}>
              <rect x={364} y={b.y} width="224" height="46" rx="5" fill={C.surface} stroke={C.borderStrong} />
              <text x={372} y={b.y + 16} fill={C.text} fontSize="11" fontWeight="bold">
                {b.label}
              </text>
              <text x={372} y={b.y + 32} fill={C.textFaint} fontSize="9">
                {b.role}
              </text>
              {b.chip && (
                <g>
                  <rect x={478} y={b.y + 10} width="102" height="26" rx="4" fill={C.accent} opacity="0.14" stroke={C.accent} />
                  <text x={529} y={b.y + 27} fill={C.accent} fontSize="10.5" fontWeight="bold" textAnchor="middle">
                    {b.chip}
                  </text>
                </g>
              )}
            </g>
          ));
        })()}

        {/* 値に工数・件数も置ける補足 */}
        <text x="364" y="322" fill={C.textMuted} fontSize="9">
          ※「値」には工数（人日）や件数も
        </text>
        <text x="364" y="335" fill={C.textMuted} fontSize="9">
          　追加で置けます（並べて比較できます）。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 図3: 値フィールドの設定 →［計算の種類］。
//      「列集計に対する比率（構成比%）」「累計」を選ぶ UI モック。費用集計での使い分けを併記。
// ════════════════════════════════════════════════════════════════════════════
export function CostPivotCalcDiagram() {
  return (
    <DiagramFrame
      step={2}
      title="計算の種類：構成比（％）・累計を出す"
      ariaLabel="値フィールドの設定の計算の種類タブのモック図。費用の値を右クリックして値フィールドの設定を開き、計算の種類から「列集計に対する比率（構成比%）」や「累計」を選びます。費用集計での使い分けとして、構成比は費目割合の把握、累計は予算消化ペースの確認に有用である旨を併記しています。"
    >
      <svg {...svgProps(600, 280)}>
        <ArrowDefs id="cost-arrow-calc" />
        {/* 値ボックス（右クリック対象） */}
        <rect x="14" y="20" width="160" height="34" rx="5" fill={C.surface} stroke={C.borderStrong} />
        <text x="94" y="41" fill={C.text} fontSize="11" fontWeight="bold" textAnchor="middle">
          合計 / 費用
        </text>
        <text x="14" y="72" fill={C.textMuted} fontSize="10">
          値を右クリック →
        </text>

        {/* 右クリックの小メニュー */}
        <line x1="178" y1="37" x2="216" y2="37" stroke={C.accent} strokeWidth="2" markerEnd="url(#cost-arrow-calc)" />
        <rect x="220" y="14" width="180" height="84" rx="6" fill={C.surface} stroke={C.borderStrong} />
        {['値の表示形式', '値フィールドの設定…', '並べ替え'].map((m, i) => {
          const hot = m === '値フィールドの設定…';
          return (
            <g key={m}>
              {hot && <rect x="222" y={16 + i * 26} width="176" height="26" fill={C.accent} opacity="0.14" />}
              <text x="232" y={33 + i * 26} fill={hot ? C.accent : C.text} fontSize="10.5" fontWeight={hot ? 'bold' : 'normal'}>
                {m}
              </text>
            </g>
          );
        })}

        {/* 設定ダイアログ:［計算の種類］タブ */}
        <line x1="310" y1="100" x2="310" y2="126" stroke={C.accent} strokeWidth="2" markerEnd="url(#cost-arrow-calc)" />
        <rect x="150" y="128" width="300" height="140" rx="6" fill={C.surface2} stroke={C.borderStrong} />
        <text x="164" y="148" fill={C.text} fontSize="11" fontWeight="bold">
          値フィールドの設定 ＞［計算の種類］
        </text>
        {[
          { label: '計算なし（実額の合計）', sel: false },
          { label: '列集計に対する比率（構成比%）', sel: true },
          { label: '累計', sel: true },
          { label: '基準値に対する比率', sel: false },
        ].map((o, i) => (
          <g key={o.label}>
            <rect x={166} y={160 + i * 24} width="13" height="13" rx="3" fill={o.sel ? C.accent : C.surface} stroke={o.sel ? C.accent : C.borderStrong} />
            {o.sel && (
              <path d={`M${168.5},${167 + i * 24} l3,3 l5,-6`} fill="none" stroke={C.bg} strokeWidth="1.6" />
            )}
            <text x={186} y={171 + i * 24} fill={C.text} fontSize="10.5" fontWeight={o.sel ? 'bold' : 'normal'}>
              {o.label}
            </text>
          </g>
        ))}

        {/* 使い分けの併記 */}
        <rect x="462" y="128" width="126" height="140" rx="5" fill={C.surface} stroke={C.border} />
        <text x="472" y="146" fill={C.textMuted} fontSize="10" fontWeight="bold">
          費用集計での使い分け
        </text>
        <text x="472" y="168" fill={C.text} fontSize="9.5" fontWeight="bold">
          構成比%
        </text>
        <text x="472" y="182" fill={C.textMuted} fontSize="9">
          費目割合の把握
        </text>
        <text x="472" y="206" fill={C.text} fontSize="9.5" fontWeight="bold">
          累計
        </text>
        <text x="472" y="220" fill={C.textMuted} fontSize="9">
          予算消化ペース
        </text>
        <text x="472" y="234" fill={C.textMuted} fontSize="9">
          の確認
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 図4: 発生月（行/列）を右クリック →［グループ化］で 月→四半期 にまとめる前後イメージ。
// ════════════════════════════════════════════════════════════════════════════
export function CostPivotGroupingDiagram() {
  return (
    <DiagramFrame
      step={3}
      title="グループ化：発生月を月→四半期にまとめる"
      ariaLabel="発生月のグループ化の前後を示す図。左は発生月が 4月・5月・6月・7月と月単位で細かく並ぶ状態、発生月のセルを右クリックしてグループ化を選ぶと、右では第1四半期・第2四半期のように四半期単位にまとまります。月次では細かすぎる費用報告を畳んで読みやすくする操作です。"
    >
      <svg {...svgProps(600, 230)}>
        <ArrowDefs id="cost-arrow-group" />

        {/* 左: 月単位（前） */}
        <text x="14" y="18" fill={C.textMuted} fontSize="11" fontWeight="bold">
          グループ化の前：月単位
        </text>
        <rect x="14" y="26" width="180" height="170" rx="6" fill={C.surface} stroke={C.borderStrong} />
        <rect x="14" y="26" width="180" height="24" rx="6" fill={C.surface3} />
        <text x="24" y="42" fill={C.text} fontSize="10" fontWeight="bold">
          発生月
        </text>
        <text x="150" y="42" fill={C.textMuted} fontSize="9.5" textAnchor="end">
          費用（千円）
        </text>
        {[
          ['2026-04', '1,540'],
          ['2026-05', '2,360'],
          ['2026-06', '4,080'],
          ['2026-07', '2,910'],
        ].map(([m, v], i) => (
          <g key={m}>
            <line x1="14" y1={50 + (i + 1) * 28} x2="194" y2={50 + (i + 1) * 28} stroke={C.border} strokeWidth="0.5" />
            <text x="24" y={50 + i * 28 + 19} fill={C.text} fontSize="10">
              {m}
            </text>
            <text x="184" y={50 + i * 28 + 19} fill={C.text} fontSize="10" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <text x="24" y="190" fill={C.textFaint} fontSize="9">
          右クリック →［グループ化］
        </text>

        {/* 矢印 */}
        <line x1="206" y1="110" x2="250" y2="110" stroke={C.accent} strokeWidth="3" markerEnd="url(#cost-arrow-group)" />
        <text x="228" y="98" fill={C.accent} fontSize="9.5" fontWeight="bold" textAnchor="middle">
          四半期に
        </text>
        <text x="228" y="126" fill={C.accent} fontSize="9.5" fontWeight="bold" textAnchor="middle">
          まとめる
        </text>

        {/* 右: 四半期単位（後） */}
        <text x="266" y="18" fill={C.textMuted} fontSize="11" fontWeight="bold">
          グループ化の後：四半期単位
        </text>
        <rect x="266" y="26" width="180" height="114" rx="6" fill={C.surface} stroke={C.borderStrong} />
        <rect x="266" y="26" width="180" height="24" rx="6" fill={C.surface3} />
        <text x="276" y="42" fill={C.text} fontSize="10" fontWeight="bold">
          発生月（四半期）
        </text>
        <text x="436" y="42" fill={C.textMuted} fontSize="9.5" textAnchor="end">
          費用（千円）
        </text>
        {[
          ['第1四半期', '7,980'],
          ['第2四半期', '2,910'],
        ].map(([q, v], i) => (
          <g key={q}>
            <line x1="266" y1={50 + (i + 1) * 30} x2="446" y2={50 + (i + 1) * 30} stroke={C.border} strokeWidth="0.5" />
            <rect x="266" y={50 + i * 30} width="180" height="30" fill={C.okBg} opacity="0.5" />
            <text x="276" y={50 + i * 30 + 20} fill={C.text} fontSize="10" fontWeight="bold">
              {q}
            </text>
            <text x="436" y={50 + i * 30 + 20} fill={C.text} fontSize="10" fontWeight="bold" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <text x="266" y="160" fill={C.textMuted} fontSize="9.5">
          月次では細かすぎる報告を、四半期に畳んで
        </text>
        <text x="266" y="174" fill={C.textMuted} fontSize="9.5">
          推移を読みやすくできます。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 図5: 完成イメージ。費目×月のクロス集計（費用合計）＋構成比列＋スライサー（担当/フェーズ）。
//      費用上位や偏りが一目で分かる注記。
// ════════════════════════════════════════════════════════════════════════════
export function CostPivotResultDiagram() {
  return (
    <DiagramFrame
      step={4}
      title="完成イメージ：クロス集計＋構成比＋スライサー"
      ariaLabel="完成したピボットの図。行が費目（人件費・外注費・ライセンス・経費）、列が発生月（4月・5月・6月）と構成比のクロス集計表に総計があり、右側に担当（ベンダー）とフェーズをボタンで切り替えるスライサーが添えられています。外注費の費用が大きく構成比も高いことが一目で分かります。"
    >
      <svg {...svgProps(600, 300)}>
        {/* 完成したクロス集計表（図1の右と整合）＋構成比列 */}
        {(() => {
          const ox = 14;
          const oy = 20;
          const colX = [ox, ox + 76, ox + 118, ox + 160, ox + 202, ox + 248]; // 費目/4月/5月/6月/総計/構成比
          const colW = [76, 42, 42, 42, 46, 50];
          const header = ['費目', '4月', '5月', '6月', '総計', '構成比'];
          const data: [string, string, string, string, string, string][] = [
            ['人件費', '1,200', '1,200', '1,200', '3,600', '45%'],
            ['外注費', '300', '500', '2,800', '3,600', '45%'],
            ['ライセンス', '—', '600', '—', '600', '8%'],
            ['経費', '40', '60', '80', '180', '2%'],
            ['総計', '1,540', '2,360', '4,080', '7,980', '100%'],
          ];
          const rowH = 26;
          const cells: ReactNode[] = [];
          header.forEach((h, c) => {
            cells.push(
              <g key={`rh-${c}`}>
                <rect x={colX[c]} y={oy} width={colW[c]} height={rowH} fill={C.surface3} stroke={C.border} />
                <text
                  x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] / 2}
                  y={oy + 17}
                  fill={C.text}
                  fontSize={c === 0 ? '10' : '10.5'}
                  fontWeight="bold"
                  textAnchor={c === 0 ? 'start' : 'middle'}
                >
                  {h}
                </text>
              </g>,
            );
          });
          data.forEach((row, r) => {
            const y = oy + (r + 1) * rowH;
            const isTotal = r === data.length - 1;
            row.forEach((v, c) => {
              const isHot = r === 1 && (c === 3 || c === 5); // 外注費の 6 月・構成比を強調
              const isPctCol = c === 5;
              cells.push(
                <g key={`rd-${r}-${c}`}>
                  <rect
                    x={colX[c]}
                    y={y}
                    width={colW[c]}
                    height={rowH}
                    fill={isTotal ? C.surface2 : isHot ? C.warnBg : isPctCol ? C.surface2 : C.surface}
                    stroke={C.border}
                  />
                  <text
                    x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] - 6}
                    y={y + 17}
                    fill={isHot ? C.warn : C.text}
                    fontSize={c === 0 ? '10' : '10.5'}
                    fontWeight={isTotal || isHot ? 'bold' : 'normal'}
                    textAnchor={c === 0 ? 'start' : 'end'}
                  >
                    {v}
                  </text>
                </g>,
              );
            });
          });
          return cells;
        })()}
        <text x="14" y="190" fill={C.textFaint} fontSize="9">
          金額は千円（値＝費用合計）。構成比＝列集計に対する比率。
        </text>

        {/* スライサー（担当・フェーズ） */}
        <text x="316" y="34" fill={C.textMuted} fontSize="11" fontWeight="bold">
          スライサー（ボタンで絞り込み）
        </text>
        {/* 担当スライサー */}
        <rect x="316" y="44" width="132" height="116" rx="6" fill={C.surface} stroke={C.borderStrong} />
        <text x="326" y="60" fill={C.text} fontSize="10" fontWeight="bold">
          担当（ベンダー）
        </text>
        {['A社', 'B社', '社内'].map((b, i) => {
          const on = i === 0;
          return (
            <g key={b}>
              <rect
                x={326}
                y={68 + i * 26}
                width="112"
                height="20"
                rx="3"
                fill={on ? C.accent : C.surface2}
                stroke={on ? C.accent : C.border}
                opacity={on ? 0.85 : 1}
              />
              <text
                x={382}
                y={82 + i * 26}
                fill={on ? C.bg : C.textMuted}
                fontSize="10"
                fontWeight={on ? 'bold' : 'normal'}
                textAnchor="middle"
              >
                {b}
              </text>
            </g>
          );
        })}
        {/* フェーズスライサー */}
        <rect x="458" y="44" width="128" height="116" rx="6" fill={C.surface} stroke={C.borderStrong} />
        <text x="468" y="60" fill={C.text} fontSize="10" fontWeight="bold">
          フェーズ
        </text>
        {['開発', 'テスト', '設計'].map((s, i) => {
          const on = i === 0;
          return (
            <g key={s}>
              <rect
                x={468}
                y={68 + i * 26}
                width="108"
                height="20"
                rx="3"
                fill={on ? C.accent : C.surface2}
                stroke={on ? C.accent : C.border}
                opacity={on ? 0.85 : 1}
              />
              <text
                x={522}
                y={82 + i * 26}
                fill={on ? C.bg : C.textMuted}
                fontSize="10"
                fontWeight={on ? 'bold' : 'normal'}
                textAnchor="middle"
              >
                {s}
              </text>
            </g>
          );
        })}
        <text x="316" y="180" fill={C.warn} fontSize="9.5">
          ※ 外注費の費用が大きく構成比も高いことが一目で分かります。
        </text>
        <text x="316" y="194" fill={C.textFaint} fontSize="9">
          担当・フェーズで絞れば、費用上位や偏りを掘り下げられます。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 高度分析 図A: 計算フィールドの挿入ダイアログのモック＋結果列イメージ。
//      ［フィールド/アイテム/セット］→［集計フィールド］で 単価＝費用/工数 を作り、
//      値エリアに「単価」列が現れる様子。
// ════════════════════════════════════════════════════════════════════════════
export function CostPivotCalcFieldDiagram() {
  return (
    <DiagramFrame
      title="計算フィールド：ピボットの中で単価・差異を算出する"
      ariaLabel="集計フィールドの挿入ダイアログのモック図。名前に単価、数式に イコール 費用 割る 工数 を入力して追加します。右側には、費目ごとの費用・工数に加えて、計算で求めた単価の列が並んだピボットの結果イメージがあります。生データに列を足さずにピボット内で算出できることを示しています。"
    >
      <svg {...svgProps(600, 280)}>
        <ArrowDefs id="cost-arrow-calcfield" />

        {/* 左: 集計フィールドの挿入ダイアログ */}
        <rect x="14" y="16" width="276" height="248" rx="6" fill={C.surface2} stroke={C.borderStrong} />
        <rect x="14" y="16" width="276" height="26" rx="6" fill={C.surface3} />
        <text x="26" y="34" fill={C.text} fontSize="11" fontWeight="bold">
          集計フィールドの挿入
        </text>
        <text x="26" y="62" fill={C.textMuted} fontSize="10">
          ［ピボットテーブル分析］→
        </text>
        <text x="26" y="76" fill={C.textMuted} fontSize="10">
          ［フィールド/アイテム/セット］→［集計フィールド］
        </text>

        {/* 名前 */}
        <text x="26" y="104" fill={C.text} fontSize="10" fontWeight="bold">
          名前
        </text>
        <rect x="26" y="110" width="240" height="24" rx="4" fill={C.surface} stroke={C.border} />
        <text x="34" y="126" fill={C.text} fontSize="11">
          単価
        </text>

        {/* 数式 */}
        <text x="26" y="156" fill={C.text} fontSize="10" fontWeight="bold">
          数式
        </text>
        <rect x="26" y="162" width="240" height="24" rx="4" fill={C.surface} stroke={C.accent} />
        <text x="34" y="178" fill={C.accent} fontSize="11" fontWeight="bold">
          ＝費用 / 工数
        </text>

        {/* 他の例 */}
        <text x="26" y="206" fill={C.textMuted} fontSize="9">
          他の例：予実差異＝実績 − 予算
        </text>
        <text x="26" y="220" fill={C.textMuted} fontSize="9">
          　　　　消化率＝実績 / 予算（％表示）
        </text>

        {/* 追加ボタン */}
        <rect x="186" y="232" width="80" height="22" rx="4" fill={C.accent} opacity="0.85" />
        <text x="226" y="247" fill={C.bg} fontSize="10" fontWeight="bold" textAnchor="middle">
          追加
        </text>

        {/* 矢印 */}
        <line x1="294" y1="140" x2="330" y2="140" stroke={C.accent} strokeWidth="3" markerEnd="url(#cost-arrow-calcfield)" />
        <text x="312" y="128" fill={C.accent} fontSize="9.5" fontWeight="bold" textAnchor="middle">
          値に列追加
        </text>

        {/* 右: 結果列イメージ（単価が新しい列に） */}
        <text x="336" y="34" fill={C.textMuted} fontSize="11" fontWeight="bold">
          結果（値エリアに「単価」列）
        </text>
        {(() => {
          const ox = 336;
          const oy = 44;
          const colX = [ox, ox + 92, ox + 142, ox + 192]; // 費目 / 費用 / 工数 / 単価
          const colW = [92, 50, 50, 60];
          const header = ['費目', '費用', '工数', '単価'];
          const data: [string, string, string, string][] = [
            ['人件費', '3,600', '180', '20'],
            ['外注費', '3,600', '90', '40'],
            ['経費', '180', '—', '—'],
          ];
          const rowH = 26;
          const cells: ReactNode[] = [];
          header.forEach((h, c) => {
            const isCalc = c === 3;
            cells.push(
              <g key={`cf-h-${c}`}>
                <rect x={colX[c]} y={oy} width={colW[c]} height={rowH} fill={isCalc ? C.okBg : C.surface3} stroke={C.border} />
                <text
                  x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] / 2}
                  y={oy + 17}
                  fill={isCalc ? C.ok : C.text}
                  fontSize="10.5"
                  fontWeight="bold"
                  textAnchor={c === 0 ? 'start' : 'middle'}
                >
                  {h}
                </text>
              </g>,
            );
          });
          data.forEach((row, r) => {
            const y = oy + (r + 1) * rowH;
            row.forEach((v, c) => {
              const isCalc = c === 3;
              cells.push(
                <g key={`cf-d-${r}-${c}`}>
                  <rect x={colX[c]} y={y} width={colW[c]} height={rowH} fill={isCalc ? C.okBg : C.surface} stroke={C.border} opacity={isCalc ? 0.6 : 1} />
                  <text
                    x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] - 6}
                    y={y + 17}
                    fill={isCalc ? C.ok : c === 0 ? C.textMuted : C.text}
                    fontSize="10.5"
                    fontWeight={isCalc ? 'bold' : 'normal'}
                    textAnchor={c === 0 ? 'start' : 'end'}
                  >
                    {v}
                  </text>
                </g>,
              );
            });
          });
          return cells;
        })()}
        <text x="336" y="178" fill={C.textFaint} fontSize="9">
          費用・工数は千円・人日。単価＝費用/工数 を
        </text>
        <text x="336" y="191" fill={C.textFaint} fontSize="9">
          ピボットの中で算出（生データは変えません）。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 高度分析 図B: 値の表示形式の応用。費目×月の表に「前月比%」「累計」列が並び、
//      小さな折れ線で月次トレンドを添える。
// ════════════════════════════════════════════════════════════════════════════
export function CostPivotTrendFormatDiagram() {
  return (
    <DiagramFrame
      title="値の表示形式：前月比・累計を数式なしで出す"
      ariaLabel="費用の月次推移の表と折れ線の図。発生月ごとに費用合計、前月比パーセント、累計の3つの列が並びます。前月比は計算の種類で前の値を基準にしたもの、累計は積み上げで、いずれも数式を書かず計算の種類を選ぶだけで出せます。下に費用の月次推移を示す小さな折れ線グラフを添えています。"
    >
      <svg {...svgProps(600, 270)}>
        {/* 左: 月次の表（費用・前月比・累計） */}
        {(() => {
          const ox = 14;
          const oy = 20;
          const colX = [ox, ox + 86, ox + 142, ox + 198]; // 発生月 / 費用 / 前月比 / 累計
          const colW = [86, 56, 56, 64];
          const header = ['発生月', '費用', '前月比', '累計'];
          const data: [string, string, string, string][] = [
            ['2026-04', '1,540', '—', '1,540'],
            ['2026-05', '2,360', '153%', '3,900'],
            ['2026-06', '4,080', '173%', '7,980'],
            ['2026-07', '2,910', '71%', '10,890'],
          ];
          const rowH = 26;
          const cells: ReactNode[] = [];
          header.forEach((h, c) => {
            const isFmt = c === 2 || c === 3;
            cells.push(
              <g key={`tf-h-${c}`}>
                <rect x={colX[c]} y={oy} width={colW[c]} height={rowH} fill={isFmt ? C.okBg : C.surface3} stroke={C.border} />
                <text
                  x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] / 2}
                  y={oy + 17}
                  fill={isFmt ? C.ok : C.text}
                  fontSize="10.5"
                  fontWeight="bold"
                  textAnchor={c === 0 ? 'start' : 'middle'}
                >
                  {h}
                </text>
              </g>,
            );
          });
          data.forEach((row, r) => {
            const y = oy + (r + 1) * rowH;
            row.forEach((v, c) => {
              const isFmt = c === 2 || c === 3;
              cells.push(
                <g key={`tf-d-${r}-${c}`}>
                  <rect x={colX[c]} y={y} width={colW[c]} height={rowH} fill={isFmt ? C.okBg : C.surface} stroke={C.border} opacity={isFmt ? 0.5 : 1} />
                  <text
                    x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] - 6}
                    y={y + 17}
                    fill={c === 0 ? C.textMuted : C.text}
                    fontSize="10.5"
                    textAnchor={c === 0 ? 'start' : 'end'}
                  >
                    {v}
                  </text>
                </g>,
              );
            });
          });
          return cells;
        })()}
        <text x="14" y="160" fill={C.textFaint} fontSize="9">
          前月比＝［基準値に対する比率］で基準を「(前の値)」に。
        </text>
        <text x="14" y="173" fill={C.textFaint} fontSize="9">
          累計＝［累計］。どちらも数式なし（千円）。
        </text>

        {/* 右: 小さな折れ線（費用の月次推移） */}
        <text x="336" y="34" fill={C.textMuted} fontSize="11" fontWeight="bold">
          費用の月次推移
        </text>
        <rect x="336" y="44" width="250" height="150" rx="6" fill={C.surface} stroke={C.border} />
        {(() => {
          // 軸（簡易）と折れ線。値: 1540 / 2360 / 4080 / 2910（最大 4080 を上端に）。
          const plotX = 360;
          const plotY = 60;
          const plotW = 206;
          const plotH = 110;
          const vals = [1540, 2360, 4080, 2910];
          const labels = ['4月', '5月', '6月', '7月'];
          const max = 4200;
          const pts = vals.map((v, i) => {
            const x = plotX + (plotW / (vals.length - 1)) * i;
            const y = plotY + plotH - (v / max) * plotH;
            return [x, y] as const;
          });
          const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
          const nodes: ReactNode[] = [];
          // 軸線
          nodes.push(
            <line key="axis-x" x1={plotX} y1={plotY + plotH} x2={plotX + plotW} y2={plotY + plotH} stroke={C.border} strokeWidth="1" />,
          );
          nodes.push(
            <line key="axis-y" x1={plotX} y1={plotY} x2={plotX} y2={plotY + plotH} stroke={C.border} strokeWidth="1" />,
          );
          nodes.push(<path key="line" d={path} fill="none" stroke={C.accent} strokeWidth="2" />);
          pts.forEach(([x, y], i) => {
            nodes.push(<circle key={`pt-${i}`} cx={x} cy={y} r="3" fill={C.accent} />);
            nodes.push(
              <text key={`lb-${i}`} x={x} y={plotY + plotH + 14} fill={C.textMuted} fontSize="9" textAnchor="middle">
                {labels[i]}
              </text>,
            );
          });
          return nodes;
        })()}
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 高度分析 図C: パレート図（ABC 分析）。費目を費用降順に棒で並べ、
//      累計構成比を折れ線で重ね、70%/90% 補助線と A/B/C 帯を示す。
// ════════════════════════════════════════════════════════════════════════════
export function CostPivotParetoDiagram() {
  return (
    <DiagramFrame
      title="ABC 分析（パレート）：費用降順＋累計構成比で重点を絞る"
      ariaLabel="パレート図。費目を費用の大きい順に棒グラフで並べ、外注費・人件費・ライセンス・経費の順です。累計構成比を折れ線で重ね、70パーセントと90パーセントの補助線を引いています。累計70パーセントまでをA、90パーセントまでをB、残りをCと区分し、上位わずかな費目で費用の大半を占めることを示しています。"
    >
      <svg {...svgProps(600, 280)}>
        {(() => {
          const plotX = 60;
          const plotY = 30;
          const plotW = 480;
          const plotH = 180;
          // 費目（費用降順）と費用（千円）。
          const items = [
            { name: '外注費', val: 3600 },
            { name: '人件費', val: 3600 },
            { name: 'ライセンス', val: 600 },
            { name: '経費', val: 180 },
          ];
          const total = items.reduce((s, it) => s + it.val, 0);
          const maxBar = 4000;
          let cum = 0;
          const cumPct = items.map((it) => {
            cum += it.val;
            return cum / total;
          });
          const n = items.length;
          const slotW = plotW / n;
          const barW = slotW * 0.5;
          const nodes: ReactNode[] = [];

          // A/B/C 帯（背景）: 累計 70% / 90% でしきい値。境界を棒の位置で近似（A=1本目, B=2-3本目, C=4本目）。
          // ここでは見やすさ優先で帯を3分割（A: 1本目, B: 2,3本目, C: 4本目）。
          const bands = [
            { from: 0, to: 1, label: 'A', color: C.warnBg },
            { from: 1, to: 3, label: 'B', color: C.okBg },
            { from: 3, to: 4, label: 'C', color: C.surface2 },
          ];
          bands.forEach((b) => {
            const x = plotX + b.from * slotW;
            const w = (b.to - b.from) * slotW;
            nodes.push(<rect key={`band-${b.label}`} x={x} y={plotY} width={w} height={plotH} fill={b.color} opacity="0.4" />);
            nodes.push(
              <text key={`band-l-${b.label}`} x={x + w / 2} y={plotY + 14} fill={C.textMuted} fontSize="11" fontWeight="bold" textAnchor="middle">
                {b.label}
              </text>,
            );
          });

          // 軸
          nodes.push(<line key="ax" x1={plotX} y1={plotY + plotH} x2={plotX + plotW} y2={plotY + plotH} stroke={C.border} strokeWidth="1" />);
          nodes.push(<line key="ay" x1={plotX} y1={plotY} x2={plotX} y2={plotY + plotH} stroke={C.border} strokeWidth="1" />);

          // 70% / 90% 補助線（右軸=構成比 0〜100% を plotH にマップ）。
          [0.7, 0.9].forEach((p) => {
            const y = plotY + plotH - p * plotH;
            nodes.push(
              <line key={`aux-${p}`} x1={plotX} y1={y} x2={plotX + plotW} y2={y} stroke={C.warn} strokeWidth="1" strokeDasharray="5 4" opacity="0.7" />,
            );
            nodes.push(
              <text key={`aux-l-${p}`} x={plotX + plotW + 2} y={y + 4} fill={C.warn} fontSize="9" textAnchor="end">
                {Math.round(p * 100)}%
              </text>,
            );
          });

          // 棒（費用）
          items.forEach((it, i) => {
            const cx = plotX + i * slotW + slotW / 2;
            const h = (it.val / maxBar) * plotH;
            const x = cx - barW / 2;
            const y = plotY + plotH - h;
            nodes.push(<rect key={`bar-${i}`} x={x} y={y} width={barW} height={h} rx="2" fill={C.accent} opacity="0.55" />);
            nodes.push(
              <text key={`bar-v-${i}`} x={cx} y={y - 4} fill={C.text} fontSize="9" textAnchor="middle">
                {it.val.toLocaleString()}
              </text>,
            );
            nodes.push(
              <text key={`bar-n-${i}`} x={cx} y={plotY + plotH + 14} fill={C.textMuted} fontSize="9.5" textAnchor="middle">
                {it.name}
              </text>,
            );
          });

          // 累計構成比 折れ線
          const linePts = cumPct.map((p, i) => {
            const cx = plotX + i * slotW + slotW / 2;
            const y = plotY + plotH - p * plotH;
            return [cx, y] as const;
          });
          const linePath = linePts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
          nodes.push(<path key="cum-line" d={linePath} fill="none" stroke={C.warn} strokeWidth="2" />);
          linePts.forEach(([x, y], i) => {
            nodes.push(<circle key={`cum-pt-${i}`} cx={x} cy={y} r="3" fill={C.warn} />);
            nodes.push(
              <text key={`cum-l-${i}`} x={x} y={y - 7} fill={C.warn} fontSize="9" fontWeight="bold" textAnchor="middle">
                {Math.round(cumPct[i] * 100)}%
              </text>,
            );
          });

          return nodes;
        })()}
        {/* 凡例・注記 */}
        <rect x="60" y="244" width="14" height="9" rx="2" fill={C.accent} opacity="0.55" />
        <text x="80" y="252" fill={C.textMuted} fontSize="9.5">
          棒＝費用（千円・降順）
        </text>
        <line x1="220" y1="249" x2="238" y2="249" stroke={C.warn} strokeWidth="2" />
        <text x="244" y="252" fill={C.textMuted} fontSize="9.5">
          折れ線＝累計構成比（A:〜70% / B:〜90% / C:残り）
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 高度分析 図D: 条件付き書式（カラースケール）のヒートマップ。
//      費目×月クロス集計の各セルを濃淡で着色し、突出した月を一目で示す。
// ════════════════════════════════════════════════════════════════════════════
export function CostPivotHeatmapDiagram() {
  return (
    <DiagramFrame
      title="条件付き書式：ヒートマップで突出した月を見つける"
      ariaLabel="費目掛ける月のクロス集計に条件付き書式のカラースケールを適用したヒートマップの図。金額が大きいセルほど濃く着色され、外注費の6月が最も濃く突出していることが一目で分かります。色は表示上の装飾で、元の数字や集計結果は変わりません。"
    >
      <svg {...svgProps(600, 250)}>
        {(() => {
          const ox = 70;
          const oy = 30;
          const cellW = 120;
          const cellH = 36;
          const months = ['4月', '5月', '6月', '7月'];
          const rows: { name: string; vals: number[] }[] = [
            { name: '人件費', vals: [1200, 1200, 1200, 1200] },
            { name: '外注費', vals: [300, 500, 2800, 600] },
            { name: 'ライセンス', vals: [0, 600, 0, 0] },
            { name: '経費', vals: [40, 60, 80, 110] },
          ];
          // 全セルの最大値で濃さを正規化（カラースケール風）。
          const max = Math.max(...rows.flatMap((r) => r.vals));
          const nodes: ReactNode[] = [];

          // 列ヘッダ（月）
          months.forEach((m, c) => {
            nodes.push(
              <text key={`hm-${c}`} x={ox + c * cellW + cellW / 2} y={oy - 8} fill={C.textMuted} fontSize="10.5" fontWeight="bold" textAnchor="middle">
                {m}
              </text>,
            );
          });

          rows.forEach((row, r) => {
            // 行ラベル
            nodes.push(
              <text key={`hr-${r}`} x={ox - 8} y={oy + r * cellH + cellH / 2 + 4} fill={C.text} fontSize="10.5" textAnchor="end">
                {row.name}
              </text>,
            );
            row.vals.forEach((v, c) => {
              const x = ox + c * cellW;
              const y = oy + r * cellH;
              // 濃さ: 0〜1 を opacity に。最濃セル（外注費6月）は注意色、その他は accent。
              const ratio = max > 0 ? v / max : 0;
              const isPeak = row.name === '外注費' && c === 2;
              const fill = isPeak ? C.warn : C.accent;
              nodes.push(
                <g key={`hc-${r}-${c}`}>
                  <rect x={x} y={y} width={cellW} height={cellH} fill={C.surface} stroke={C.border} />
                  {v > 0 && (
                    <rect x={x} y={y} width={cellW} height={cellH} fill={fill} opacity={0.12 + ratio * 0.6} />
                  )}
                  <text
                    x={x + cellW - 8}
                    y={y + cellH / 2 + 4}
                    fill={C.text}
                    fontSize="10.5"
                    fontWeight={isPeak ? 'bold' : 'normal'}
                    textAnchor="end"
                  >
                    {v > 0 ? v.toLocaleString() : '—'}
                  </text>
                </g>,
              );
            });
          });
          return nodes;
        })()}
        <text x="70" y="206" fill={C.warn} fontSize="9.5">
          ※ 外注費の 6 月が最も濃く、突出した月が一目で分かります。
        </text>
        <text x="70" y="220" fill={C.textFaint} fontSize="9">
          金額は千円。色は表示上の装飾で、集計結果は変わりません。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 高度分析 図E: 予実対比。実績表＋予算表 →（リレーション/結合）→
//      予算/実績/差異/消化率のクロス集計。データモデル・メジャー入門に軽く触れる。
// ════════════════════════════════════════════════════════════════════════════
export function CostPivotBudgetActualDiagram() {
  return (
    <DiagramFrame
      title="予実対比：実績と予算表を結合して差異・消化率を1表に"
      ariaLabel="予実対比の図。左に実績表と予算表の2つの表があり、費目と発生月をキーにリレーションで結合します。右にはその結果として、費目ごとに予算・実績・差異・消化率が並んだクロス集計表があり、外注費が予算超過で消化率が高いことを示しています。データモデルやメジャー（DAX）で複数表をまたいで計算できる旨を添えています。"
    >
      <svg {...svgProps(600, 300)}>
        <ArrowDefs id="cost-arrow-budget" />

        {/* 左: 実績表 + 予算表 */}
        <text x="14" y="22" fill={C.textMuted} fontSize="10.5" fontWeight="bold">
          実績表
        </text>
        <rect x="14" y="28" width="150" height="74" rx="5" fill={C.surface} stroke={C.borderStrong} />
        <rect x="14" y="28" width="150" height="20" rx="5" fill={C.surface3} />
        <text x="22" y="42" fill={C.text} fontSize="9">
          費目 / 発生月 / 費用
        </text>
        {[['外注費', '3,600'], ['人件費', '3,600']].map(([k, v], i) => (
          <g key={`act-${k}`}>
            <text x="22" y={62 + i * 18} fill={C.text} fontSize="9.5">
              {k}
            </text>
            <text x="156" y={62 + i * 18} fill={C.text} fontSize="9.5" textAnchor="end">
              {v}
            </text>
          </g>
        ))}

        <text x="14" y="138" fill={C.textMuted} fontSize="10.5" fontWeight="bold">
          予算表
        </text>
        <rect x="14" y="144" width="150" height="74" rx="5" fill={C.surface} stroke={C.borderStrong} />
        <rect x="14" y="144" width="150" height="20" rx="5" fill={C.surface3} />
        <text x="22" y="158" fill={C.text} fontSize="9">
          費目 / 発生月 / 予算額
        </text>
        {[['外注費', '2,800'], ['人件費', '3,600']].map(([k, v], i) => (
          <g key={`bud-${k}`}>
            <text x="22" y={178 + i * 18} fill={C.text} fontSize="9.5">
              {k}
            </text>
            <text x="156" y={178 + i * 18} fill={C.text} fontSize="9.5" textAnchor="end">
              {v}
            </text>
          </g>
        ))}

        {/* リレーション（結合） */}
        <text x="182" y="116" fill={C.accent} fontSize="9.5" fontWeight="bold" textAnchor="middle">
          リレーション
        </text>
        <text x="182" y="130" fill={C.textMuted} fontSize="9" textAnchor="middle">
          キー：費目・発生月
        </text>
        <path d="M166,65 C196,65 196,123 226,123" fill="none" stroke={C.accent} strokeWidth="2" strokeDasharray="4 3" markerEnd="url(#cost-arrow-budget)" />
        <path d="M166,181 C196,181 196,123 226,123" fill="none" stroke={C.accent} strokeWidth="2" strokeDasharray="4 3" />

        {/* 矢印 → 結合後のクロス集計 */}
        <line x1="230" y1="123" x2="266" y2="123" stroke={C.accent} strokeWidth="3" markerEnd="url(#cost-arrow-budget)" />

        {/* 右: 予算/実績/差異/消化率のクロス集計 */}
        <text x="278" y="22" fill={C.textMuted} fontSize="11" fontWeight="bold">
          結合後：予算・実績・差異・消化率
        </text>
        {(() => {
          const ox = 278;
          const oy = 32;
          const colX = [ox, ox + 76, ox + 124, ox + 172, ox + 220]; // 費目/予算/実績/差異/消化率
          const colW = [76, 48, 48, 48, 60];
          const header = ['費目', '予算', '実績', '差異', '消化率'];
          const data: [string, string, string, string, string][] = [
            ['外注費', '2,800', '3,600', '+800', '129%'],
            ['人件費', '3,600', '3,600', '0', '100%'],
            ['ライセンス', '800', '600', '−200', '75%'],
            ['総計', '7,200', '7,800', '+600', '108%'],
          ];
          const rowH = 26;
          const cells: ReactNode[] = [];
          header.forEach((h, c) => {
            cells.push(
              <g key={`ba-h-${c}`}>
                <rect x={colX[c]} y={oy} width={colW[c]} height={rowH} fill={C.surface3} stroke={C.border} />
                <text
                  x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] / 2}
                  y={oy + 17}
                  fill={C.text}
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor={c === 0 ? 'start' : 'middle'}
                >
                  {h}
                </text>
              </g>,
            );
          });
          data.forEach((row, r) => {
            const y = oy + (r + 1) * rowH;
            const isTotal = r === data.length - 1;
            row.forEach((v, c) => {
              // 差異・消化率が超過の外注費行を注意色で。
              const isOver = r === 0 && (c === 3 || c === 4);
              cells.push(
                <g key={`ba-d-${r}-${c}`}>
                  <rect
                    x={colX[c]}
                    y={y}
                    width={colW[c]}
                    height={rowH}
                    fill={isTotal ? C.surface2 : isOver ? C.warnBg : C.surface}
                    stroke={C.border}
                  />
                  <text
                    x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] - 6}
                    y={y + 17}
                    fill={isOver ? C.warn : isTotal ? C.text : c === 0 ? C.textMuted : C.text}
                    fontSize="10"
                    fontWeight={isTotal || isOver ? 'bold' : 'normal'}
                    textAnchor={c === 0 ? 'start' : 'end'}
                  >
                    {v}
                  </text>
                </g>,
              );
            });
          });
          return cells;
        })()}
        <text x="278" y="186" fill={C.textFaint} fontSize="9">
          差異＝実績−予算、消化率＝実績/予算。
        </text>
        <text x="278" y="199" fill={C.textFaint} fontSize="9">
          データモデル／メジャー（DAX）で複数表をまたいで算出。
        </text>
        <text x="278" y="216" fill={C.warn} fontSize="9.5" fontWeight="bold">
          ※ 外注費が予算超過（消化率 129%）と分かります。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 応用・実務（費用分析・コンサル水準）の図。step バッジ無し・title のみ。
// 既存の C / DiagramFrame / svgProps / ArrowDefs を再利用する（再定義しない）。
// ════════════════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────────────
// Pro図1: 費用データの整形（Power Query）。
//   複数ベンダー実績 → append → 正規化/アンピボット/マージ → 1テーブル → ピボット。
// ────────────────────────────────────────────────────────────────────────────
export function CostPivotProPowerQueryDiagram() {
  const sources = ['A社_実績.xlsx', 'B社_実績.csv', '社内_実績.xlsx'];
  return (
    <DiagramFrame
      title="費用データの整形（Power Query）：複数ソース → 1 テーブル"
      ariaLabel="費用データ整形の図。左に3つの実績ソース（A社・B社・社内）が並び、結合（append）でひとつに積まれ、Power Query で税抜への統一・按分・計上月の正規化、横持ち予算表のアンピボット、費目マスタのマージ（表記ゆれ統合）を経て、整然とした1つの費用テーブルになり、最後にピボットへ流れます。各工程は右向きの矢印でつながっています。"
    >
      <svg {...svgProps(600, 250)}>
        <ArrowDefs id="cost-arrow-pq" />

        {/* 左: 複数ソース */}
        <text x="10" y="16" fill={C.textMuted} fontSize="11" fontWeight="bold">
          複数ベンダー実績
        </text>
        {sources.map((s, i) => (
          <g key={s}>
            <rect x="10" y={26 + i * 46} width="116" height="38" rx="5" fill={C.surface2} stroke={C.border} />
            <rect x="10" y={26 + i * 46} width="116" height="14" rx="5" fill={C.surface3} />
            <text x="18" y={37 + i * 46} fill={C.textMuted} fontSize="9">
              {s}
            </text>
            <line x1="18" y1={50 + i * 46} x2="118" y2={50 + i * 46} stroke={C.border} strokeWidth="0.5" />
            <line x1="18" y1={57 + i * 46} x2="100" y2={57 + i * 46} stroke={C.border} strokeWidth="0.5" />
          </g>
        ))}

        {/* 矢印: ソース → 結合 */}
        <line x1="130" y1="91" x2="166" y2="91" stroke={C.accent} strokeWidth="2.5" markerEnd="url(#cost-arrow-pq)" />
        <text x="148" y="80" fill={C.accent} fontSize="9" fontWeight="bold" textAnchor="middle">
          結合
        </text>

        {/* 中: Power Query（正規化・アンピボット・マージ） */}
        <rect x="170" y="34" width="160" height="124" rx="6" fill={C.surface} stroke={C.accent} strokeWidth="1.3" />
        <text x="250" y="52" fill={C.accent} fontSize="10.5" fontWeight="bold" textAnchor="middle">
          Power Query
        </text>
        <text x="182" y="72" fill={C.text} fontSize="9.5">
          ・append（実績を縦に積む）
        </text>
        <text x="182" y="88" fill={C.text} fontSize="9.5">
          ・予算表をアンピボット
        </text>
        <text x="194" y="101" fill={C.textMuted} fontSize="8.5">
          （横持ち→縦持ち）
        </text>
        <text x="182" y="118" fill={C.text} fontSize="9.5">
          ・費目マスタを merge
        </text>
        <text x="194" y="131" fill={C.textMuted} fontSize="8.5">
          （表記ゆれ統合）
        </text>
        <text x="182" y="148" fill={C.text} fontSize="9.5">
          ・税抜統一 / 按分 / 計上月
        </text>

        {/* 矢印: → 1テーブル */}
        <line x1="334" y1="91" x2="368" y2="91" stroke={C.accent} strokeWidth="2.5" markerEnd="url(#cost-arrow-pq)" />

        {/* 右: 1つの整然テーブル */}
        <rect x="372" y="34" width="140" height="118" rx="6" fill={C.surface2} stroke={C.ok} strokeWidth="1.3" />
        <rect x="372" y="34" width="140" height="16" rx="6" fill={C.okBg} />
        <text x="380" y="46" fill={C.ok} fontSize="9.5" fontWeight="bold">
          1 つの費用テーブル
        </text>
        {Array.from({ length: 5 }).map((_, r) => (
          <g key={r}>
            <line x1="380" y1={62 + r * 16} x2="504" y2={62 + r * 16} stroke={C.border} strokeWidth="0.5" />
            <rect x="380" y={66 + r * 16} width="34" height="6" rx="2" fill={C.borderStrong} opacity="0.5" />
            <rect x="420" y={66 + r * 16} width="34" height="6" rx="2" fill={C.borderStrong} opacity="0.5" />
            <rect x="460" y={66 + r * 16} width="40" height="6" rx="2" fill={C.ok} opacity="0.35" />
          </g>
        ))}

        {/* 矢印: → ピボット */}
        <line x1="442" y1="160" x2="442" y2="190" stroke={C.accent} strokeWidth="2.5" markerEnd="url(#cost-arrow-pq)" />
        <text x="508" y="180" fill={C.accent} fontSize="10" fontWeight="bold" textAnchor="end">
          → ピボットへ
        </text>
        <text x="10" y="180" fill={C.textFaint} fontSize="9">
          更新ボタン 1 つで再現できる前処理。
        </text>
        <text x="10" y="194" fill={C.textFaint} fontSize="9">
          翌月分の追加にも自動で追従します。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図2: 正しい単価・比率はメジャーで（平均の平均の誤りを正誤対比）。
//   × 各行単価の単純平均／○ Σ費用÷Σ工数。メジャー定義を併記。
// ────────────────────────────────────────────────────────────────────────────
export function CostPivotProMeasureDiagram() {
  return (
    <DiagramFrame
      title="正しい単価はメジャーで：合計÷合計（平均の平均を避ける）"
      ariaLabel="平均単価の正誤対比の図。左は誤りで、課題ごとの単価（費用割る工数）を単純平均すると小さな案件に引っ張られて実態とずれます。右は正しく、費用の合計を工数の合計で割って平均単価を出します。下にメジャーの定義として、平均単価はディバイドのシグマ費用シグマ工数、消化率はディバイドのシグマ実績シグマ予算、と示しています。"
    >
      <svg {...svgProps(600, 250)}>
        {(() => {
          const nodes: ReactNode[] = [];
          const rows: [string, string, string, string][] = [
            ['小課題', '100', '1', '100'],
            ['大課題', '3,500', '175', '20'],
          ];
          // 左: 誤り（各行単価の単純平均）
          nodes.push(
            <rect key="bad-box" x="14" y="16" width="276" height="150" rx="6" fill={C.surface} stroke={C.warn} strokeWidth="1.2" />,
          );
          nodes.push(
            <text key="bad-t" x="26" y="36" fill={C.warn} fontSize="10.5" fontWeight="bold">
              × 誤り：各行単価の単純平均
            </text>,
          );
          const bx = [26, 110, 168, 226];
          const bh = ['課題', '費用', '工数', '単価'];
          bh.forEach((h, c) => {
            nodes.push(
              <text key={`bad-h-${c}`} x={c === 0 ? bx[c] : bx[c] + 44} y="58" fill={C.textMuted} fontSize="9" fontWeight="bold" textAnchor={c === 0 ? 'start' : 'end'}>
                {h}
              </text>,
            );
          });
          rows.forEach((r, ri) => {
            r.forEach((v, c) => {
              const isUnit = c === 3;
              nodes.push(
                <text key={`bad-${ri}-${c}`} x={c === 0 ? bx[c] : bx[c] + 44} y={78 + ri * 18} fill={isUnit ? C.warn : C.text} fontSize="9.5" fontWeight={isUnit ? 'bold' : 'normal'} textAnchor={c === 0 ? 'start' : 'end'}>
                  {v}
                </text>,
              );
            });
          });
          nodes.push(
            <text key="bad-calc" x="26" y="128" fill={C.text} fontSize="9.5">
              (100 + 20) ÷ 2 ＝ 60 /人日
            </text>,
          );
          nodes.push(
            <text key="bad-note" x="26" y="148" fill={C.textMuted} fontSize="8.5">
              小課題に引っ張られ、実態とずれます。
            </text>,
          );

          // 右: 正（合計÷合計）
          nodes.push(
            <rect key="ok-box" x="310" y="16" width="276" height="150" rx="6" fill={C.surface} stroke={C.ok} strokeWidth="1.2" />,
          );
          nodes.push(
            <text key="ok-t" x="322" y="36" fill={C.ok} fontSize="10.5" fontWeight="bold">
              ○ 正：Σ費用 ÷ Σ工数
            </text>,
          );
          nodes.push(
            <text key="ok-1" x="322" y="62" fill={C.text} fontSize="9.5">
              Σ費用 ＝ 100 + 3,500 ＝ 3,600
            </text>,
          );
          nodes.push(
            <text key="ok-2" x="322" y="82" fill={C.text} fontSize="9.5">
              Σ工数 ＝ 1 + 175 ＝ 176
            </text>,
          );
          nodes.push(
            <text key="ok-3" x="322" y="106" fill={C.ok} fontSize="10.5" fontWeight="bold">
              平均単価 ＝ 3,600 ÷ 176 ≒ 20 /人日
            </text>,
          );
          nodes.push(
            <text key="ok-note" x="322" y="130" fill={C.textMuted} fontSize="8.5">
              工数で加重した実態どおりの単価です。
            </text>,
          );
          nodes.push(
            <text key="ok-note2" x="322" y="148" fill={C.textMuted} fontSize="8.5">
              費用は千円・工数は人日（サンプル）。
            </text>,
          );
          return nodes;
        })()}

        {/* メジャー定義 */}
        <rect x="14" y="178" width="572" height="58" rx="6" fill={C.surface2} stroke={C.accent} strokeWidth="1.1" />
        <text x="26" y="198" fill={C.accent} fontSize="10" fontWeight="bold">
          データモデルのメジャー（DAX）
        </text>
        <text x="26" y="216" fill={C.text} fontSize="9.5">
          平均単価 ＝ DIVIDE( SUM(実績[費用]), SUM(実績[工数]) )
        </text>
        <text x="26" y="230" fill={C.text} fontSize="9.5">
          消化率　 ＝ DIVIDE( SUM(実績[費用]), SUM(予算[予算額]) )
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図3: 費用差異の要因分解（ブリッジ／ウォーターフォール）。
//   予算 → 単価差(価格) → 工数差(数量) → ミックス → 実績。
// ────────────────────────────────────────────────────────────────────────────
export function CostPivotProBridgeDiagram() {
  const baseY = 168; // 0 の基準線（描画上の底）
  const scale = 0.018; // 1 千円あたりの高さ
  const start = 7200;
  const steps = [
    { label: '予算', kind: 'total' as const, to: start },
    { label: '単価差', sub: '(価格)', kind: 'up' as const, delta: 520 },
    { label: '工数差', sub: '(数量)', kind: 'up' as const, delta: 360 },
    { label: 'ミックス', sub: '(構成)', kind: 'down' as const, delta: -280 },
    { label: '実績', kind: 'total' as const, to: 7800 },
  ];
  let running = 0;
  const colW = 84;
  const gap = 28;
  const bars = steps.map((s) => {
    const prevRunning = running;
    let top: number;
    let h: number;
    if (s.kind === 'total') {
      running = s.to ?? 0;
      h = (s.to ?? 0) * scale;
      top = baseY - h;
    } else {
      const next = running + (s.delta ?? 0);
      const hi = Math.max(running, next);
      const lo = Math.min(running, next);
      h = (hi - lo) * scale;
      top = baseY - hi * scale;
      running = next;
    }
    return { ...s, top, h, prevRunning, running };
  });
  return (
    <DiagramFrame
      title="費用差異の要因分解：ブリッジ（予算 → 実績）"
      ariaLabel="費用差異のウォーターフォール（ブリッジ）チャートの図。左の予算 7,200 千円を起点に、単価差（価格）でプラス 520、工数差（数量）でプラス 360、ミックス（構成）でマイナス 280 と増減バーが積み上がり、右の実績 7,800 千円につながります。予算と実績の差 600 千円の中身が、価格・数量・ミックスに分解されて見える形です。金額は千円です。"
    >
      <svg {...svgProps(600, 210)}>
        {/* 基準線 */}
        <line x1="20" y1={baseY} x2="580" y2={baseY} stroke={C.border} strokeWidth="1" />
        {bars.map((b, i) => {
          const isTotal = b.kind === 'total';
          const isUp = b.kind === 'up';
          const fill = isTotal ? C.accent : isUp ? C.okBg : C.warnBg;
          const stroke = isTotal ? C.accent : isUp ? C.ok : C.warn;
          const x = 30 + i * (colW + gap);
          const valText =
            b.kind === 'total' ? (b.to ?? 0).toLocaleString() : `${(b.delta ?? 0) > 0 ? '+' : ''}${b.delta}`;
          return (
            <g key={b.label}>
              {/* つなぎの点線（前バーの天端から次バーへ） */}
              {i > 0 && (
                <line
                  x1={30 + (i - 1) * (colW + gap) + colW}
                  y1={isTotal ? b.top : baseY - b.prevRunning * scale}
                  x2={x}
                  y2={isTotal ? b.top : baseY - b.prevRunning * scale}
                  stroke={C.borderStrong}
                  strokeWidth="0.8"
                  strokeDasharray="3 2"
                />
              )}
              <rect
                x={x}
                y={b.top}
                width={colW}
                height={Math.max(b.h, 2)}
                rx="2"
                fill={fill}
                stroke={stroke}
                strokeWidth="1.2"
                opacity={isTotal ? 0.85 : 1}
              />
              <text x={x + colW / 2} y={b.top - 6} fill={isTotal ? C.text : stroke} fontSize="11" fontWeight="bold" textAnchor="middle">
                {valText}
              </text>
              <text x={x + colW / 2} y={baseY + 16} fill={C.textMuted} fontSize="10" textAnchor="middle">
                {b.label}
              </text>
              {b.sub && (
                <text x={x + colW / 2} y={baseY + 28} fill={C.textFaint} fontSize="8.5" textAnchor="middle">
                  {b.sub}
                </text>
              )}
            </g>
          );
        })}
        <text x="20" y="202" fill={C.textFaint} fontSize="9">
          金額は千円。差（+600）の中身を 単価差 × 工数差 × ミックス に分解しています。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図4: バーンレート＆完成時総コスト予測（EAC/ETC）。
//   累計費用の実績折れ線＋予測点線＋予算ライン＋EAC着地点。
// ────────────────────────────────────────────────────────────────────────────
export function CostPivotProEacDiagram() {
  return (
    <DiagramFrame
      title="バーンレート＆EAC：累計費用から着地額を予測する"
      ariaLabel="累計費用と完成時総コスト予測の図。横軸が月、縦軸が累計費用です。実線が実績の累計費用、その先を点線でバーンレートにもとづき予測し、最終的な着地額（EAC）が水平の予算ライン（BAC）を上回ることを示しています。予算を越える時点と最終的な超過額が事前に読み取れる形です。金額は千円です。"
    >
      <svg {...svgProps(600, 250)}>
        <ArrowDefs id="cost-arrow-eac" />
        {(() => {
          const plotX = 50;
          const plotY = 24;
          const plotW = 470;
          const plotH = 170;
          const max = 12000;
          const bac = 9000; // 予算（BAC）
          const eac = 10500; // 着地見込み（EAC）
          const months = ['4月', '5月', '6月', '7月', '8月', '9月'];
          // 累計費用: 実績（4-6月）→ 予測（7-9月、バーンレート ≒ 1,500/月）。
          const actual = [1540, 3900, 7980];
          const forecast = [7980, 9000, 10500]; // 6月終点から予測（7月超過、9月=EAC）
          const yOf = (v: number) => plotY + plotH - (v / max) * plotH;
          const xOf = (i: number) => plotX + (plotW / (months.length - 1)) * i;
          const nodes: ReactNode[] = [];

          // 軸
          nodes.push(<line key="ax" x1={plotX} y1={plotY + plotH} x2={plotX + plotW} y2={plotY + plotH} stroke={C.border} strokeWidth="1" />);
          nodes.push(<line key="ay" x1={plotX} y1={plotY} x2={plotX} y2={plotY + plotH} stroke={C.border} strokeWidth="1" />);
          months.forEach((m, i) => {
            nodes.push(
              <text key={`mx-${i}`} x={xOf(i)} y={plotY + plotH + 14} fill={C.textMuted} fontSize="9" textAnchor="middle">
                {m}
              </text>,
            );
          });

          // 予算ライン（BAC）
          const bacY = yOf(bac);
          nodes.push(<line key="bac" x1={plotX} y1={bacY} x2={plotX + plotW} y2={bacY} stroke={C.ok} strokeWidth="1.4" strokeDasharray="6 3" />);
          nodes.push(
            <text key="bac-l" x={plotX + 4} y={bacY - 5} fill={C.ok} fontSize="9" fontWeight="bold">
              予算（BAC）9,000
            </text>,
          );

          // 実績折れ線（4-6月）
          const actualPath = actual.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i)},${yOf(v)}`).join(' ');
          nodes.push(<path key="act" d={actualPath} fill="none" stroke={C.accent} strokeWidth="2.4" />);
          actual.forEach((v, i) => {
            nodes.push(<circle key={`act-${i}`} cx={xOf(i)} cy={yOf(v)} r="3.5" fill={C.accent} />);
          });

          // 予測点線（6-9月）
          const fcPath = forecast.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i + 2)},${yOf(v)}`).join(' ');
          nodes.push(<path key="fc" d={fcPath} fill="none" stroke={C.warn} strokeWidth="2" strokeDasharray="5 4" />);
          forecast.slice(1).forEach((v, i) => {
            nodes.push(<circle key={`fc-${i}`} cx={xOf(i + 3)} cy={yOf(v)} r="3" fill={C.warn} />);
          });

          // EAC 着地点の強調
          const eacY = yOf(eac);
          nodes.push(<circle key="eac-pt" cx={xOf(5)} cy={eacY} r="4.5" fill={C.warn} stroke={C.surface} strokeWidth="1.2" />);
          nodes.push(
            <text key="eac-l" x={xOf(5) - 6} y={eacY - 8} fill={C.warn} fontSize="9.5" fontWeight="bold" textAnchor="end">
              EAC 10,500
            </text>,
          );

          // 超過の注記
          nodes.push(
            <text key="over" x={xOf(5)} y={eacY + 16} fill={C.warn} fontSize="9" textAnchor="end" fontWeight="bold">
              超過 +1,500
            </text>,
          );
          return nodes;
        })()}

        {/* 凡例 */}
        <line x1="50" y1="226" x2="68" y2="226" stroke={C.accent} strokeWidth="2.4" />
        <text x="74" y="229" fill={C.textMuted} fontSize="9">
          実績（累計）
        </text>
        <line x1="170" y1="226" x2="188" y2="226" stroke={C.warn} strokeWidth="2" strokeDasharray="5 4" />
        <text x="194" y="229" fill={C.textMuted} fontSize="9">
          予測（バーンレート）
        </text>
        <text x="320" y="229" fill={C.textFaint} fontSize="9">
          EAC＝実績累計＋ETC（残見積）。7 月に予算ライン超過。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図5: Top-N ベンダー/費目＋「その他」集約＋寄与度（前月差）。
// ────────────────────────────────────────────────────────────────────────────
export function CostPivotProTopNDiagram() {
  // ベンダー別費用（上位3＋その他）。
  const items = [
    { label: 'A社', val: 3600, w: 3600, other: false },
    { label: 'B社', val: 1800, w: 1800, other: false },
    { label: 'C社', val: 980, w: 980, other: false },
    { label: 'その他（4 社）', val: 620, w: 620, other: true },
  ];
  const maxW = 3600;
  const barMax = 240;
  return (
    <DiagramFrame
      title="Top-N ベンダー＋「その他」集約と寄与度"
      ariaLabel="ベンダー別費用の図。上位3社（A社・B社・C社）を長さの異なる横棒で表示し、残りの4社を「その他」バケットにまとめています。右側には前月差への寄与度として、A社がプラス方向に最も大きく効き、C社はマイナスである旨を示しています。金額は千円です。"
    >
      <svg {...svgProps(600, 210)}>
        <text x="14" y="18" fill={C.textMuted} fontSize="11" fontWeight="bold">
          ベンダー別費用：上位 3 ＋「その他」
        </text>
        {items.map((it, i) => {
          const y = 30 + i * 38;
          const w = (it.w / maxW) * barMax;
          return (
            <g key={it.label}>
              <text x="14" y={y + 16} fill={C.text} fontSize="10" fontWeight={it.other ? 'normal' : 'bold'}>
                {it.label}
              </text>
              <rect
                x="120"
                y={y + 4}
                width={Math.max(w, 4)}
                height="18"
                rx="3"
                fill={it.other ? C.surface3 : C.accent}
                stroke={it.other ? C.borderStrong : C.accent}
                opacity={it.other ? 1 : 0.85}
              />
              <text x={120 + Math.max(w, 4) + 8} y={y + 17} fill={C.text} fontSize="10" fontWeight="bold">
                {it.val.toLocaleString()}
              </text>
            </g>
          );
        })}
        {/* 寄与度の注記パネル */}
        <rect x="400" y="30" width="186" height="150" rx="6" fill={C.surface2} stroke={C.border} />
        <text x="412" y="48" fill={C.textMuted} fontSize="10" fontWeight="bold">
          前月差への寄与度
        </text>
        {[
          { l: 'A社', v: '+700', up: true },
          { l: 'B社', v: '+120', up: true },
          { l: 'C社', v: '−180', up: false },
          { l: 'その他', v: '+60', up: true },
        ].map((c, i) => (
          <g key={c.l}>
            <text x="412" y={70 + i * 22} fill={C.text} fontSize="9.5">
              {c.l}
            </text>
            <text x="574" y={70 + i * 22} fill={c.up ? C.ok : C.warn} fontSize="10" fontWeight="bold" textAnchor="end">
              {c.v}
            </text>
          </g>
        ))}
        <text x="412" y="170" fill={C.textFaint} fontSize="8.5">
          増加の主因は A 社と読み取れます。
        </text>
        <text x="14" y="200" fill={C.textFaint} fontSize="9">
          金額は千円。［値フィルター］→［上位 N］＋残りを「その他」に畳んで集約。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図6: 費用ダッシュボード化＆QA。
//   1スライサー→複数ピボット/グラフ（GETPIVOTDATA 安定参照）＋費用QAチェックリスト。
// ────────────────────────────────────────────────────────────────────────────
export function CostPivotProDashboardQaDiagram() {
  const checks = [
    '税区分（税抜/税込）の混在はないか',
    '同一請求の二重計上はないか',
    '計上月は発生月か（請求日ズレ）',
    '共通費の按分漏れはないか',
    '元データ変更後に更新したか',
    '総計が元データ合計（SUM）と一致するか',
  ];
  return (
    <DiagramFrame
      title="費用ダッシュボード化＆QA：連動点検と費用チェックリスト"
      ariaLabel="費用ダッシュボードとQAの図。上部は1つのスライサー（案件・フェーズ・ベンダー）が、レポート接続で対予算ピボット表・ピボットグラフ・GETPIVOTDATA で安定参照する月次サマリ表を同時に絞り込む構成です。下部には費用QAチェックリストとして、税区分の混在・二重計上・計上月ズレ・按分漏れ・更新忘れ・総計突合の6項目を並べています。"
    >
      <svg {...svgProps(600, 320)}>
        <ArrowDefs id="cost-arrow-dashqa" />

        {/* スライサー（親） */}
        <rect x="222" y="12" width="156" height="44" rx="6" fill={C.surface} stroke={C.accent} strokeWidth="1.4" />
        <text x="300" y="30" fill={C.accent} fontSize="10" fontWeight="bold" textAnchor="middle">
          スライサー：案件 / フェーズ / ベンダー
        </text>
        <rect x="240" y="36" width="56" height="14" rx="3" fill={C.accent} opacity="0.85" />
        <text x="268" y="47" fill={C.bg} fontSize="8.5" fontWeight="bold" textAnchor="middle">
          ECL基盤
        </text>
        <rect x="304" y="36" width="56" height="14" rx="3" fill={C.surface2} stroke={C.border} />
        <text x="332" y="47" fill={C.textMuted} fontSize="8.5" textAnchor="middle">
          データ移行
        </text>

        {/* 接続線 → 3 つの成果物 */}
        <line x1="300" y1="56" x2="90" y2="92" stroke={C.accent} strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#cost-arrow-dashqa)" />
        <line x1="300" y1="56" x2="300" y2="92" stroke={C.accent} strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#cost-arrow-dashqa)" />
        <line x1="300" y1="56" x2="510" y2="92" stroke={C.accent} strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#cost-arrow-dashqa)" />
        <text x="300" y="78" fill={C.textMuted} fontSize="8.5" textAnchor="middle">
          レポート接続で同時に絞り込み
        </text>

        {/* 成果物1: 対予算ピボット表 */}
        <rect x="20" y="98" width="150" height="96" rx="6" fill={C.surface2} stroke={C.border} />
        <text x="95" y="116" fill={C.text} fontSize="10" fontWeight="bold" textAnchor="middle">
          対予算ピボット表
        </text>
        {Array.from({ length: 4 }).map((_, r) => (
          <g key={r}>
            <line x1="32" y1={130 + r * 14} x2="158" y2={130 + r * 14} stroke={C.border} strokeWidth="0.5" />
            <rect x="32" y={134 + r * 14} width="50" height="6" rx="2" fill={C.borderStrong} opacity="0.5" />
            <rect x="118" y={134 + r * 14} width="38" height="6" rx="2" fill={C.accent} opacity="0.35" />
          </g>
        ))}

        {/* 成果物2: ピボットグラフ */}
        <rect x="225" y="98" width="150" height="96" rx="6" fill={C.surface2} stroke={C.border} />
        <text x="300" y="116" fill={C.text} fontSize="10" fontWeight="bold" textAnchor="middle">
          ピボットグラフ
        </text>
        {[36, 60, 28, 50].map((h, i) => (
          <rect key={i} x={245 + i * 30} y={182 - h} width="20" height={h} rx="2" fill={C.accent} opacity="0.7" />
        ))}
        <line x1="237" y1="182" x2="363" y2="182" stroke={C.border} strokeWidth="0.8" />

        {/* 成果物3: 月次サマリ（GETPIVOTDATA） */}
        <rect x="430" y="98" width="150" height="96" rx="6" fill={C.surface} stroke={C.ok} strokeWidth="1.2" />
        <text x="505" y="116" fill={C.ok} fontSize="10" fontWeight="bold" textAnchor="middle">
          月次サマリ（デック用）
        </text>
        <text x="442" y="138" fill={C.text} fontSize="9">
          ＝GETPIVOTDATA(…)
        </text>
        <text x="442" y="156" fill={C.textMuted} fontSize="8.5">
          月次サマリ／対予算表へ
        </text>
        <text x="442" y="169" fill={C.textMuted} fontSize="8.5">
          項目名で安定参照。
        </text>
        <text x="442" y="186" fill={C.textFaint} fontSize="8.5">
          報告デックへリンク貼り。
        </text>

        {/* 費用 QA チェックリスト */}
        <rect x="14" y="208" width="572" height="100" rx="6" fill={C.surface2} stroke={C.warn} strokeWidth="1.1" />
        <text x="26" y="226" fill={C.warn} fontSize="10.5" fontWeight="bold">
          報告前の費用 QA チェックリスト
        </text>
        {checks.map((c, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const x = 26 + col * 290;
          const y = 244 + row * 22;
          return (
            <g key={i}>
              <rect x={x} y={y - 11} width="14" height="14" rx="3" fill={C.okBg} stroke={C.ok} strokeWidth="1.1" />
              <path d={`M${x + 3},${y - 4} l3,3 l5,-6`} fill="none" stroke={C.ok} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <text x={x + 22} y={y} fill={C.text} fontSize="9.5">
                {c}
              </text>
            </g>
          );
        })}
      </svg>
    </DiagramFrame>
  );
}
