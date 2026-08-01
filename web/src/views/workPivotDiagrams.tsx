// 仕事ページ（/work）「ピボット」タブ用の SVG 図解（MC-261）。
//
// ChatMarkdown（react-markdown）は rehype-raw 無しで raw HTML/SVG をテキスト化するため、
// Markdown 文字列に図を埋め込めない。よって Excel ピボットの実操作を再現する図解は
// React コンポーネント（この SVG 群）として実装し、WorkPivotTab で説明文と交互に配置する。
//
// 描画ルール:
//  - 配色は Apollo のデザイントークン（var(--mc-*)）のみ。直値 hex を使わない（ダーク/ライト両対応）。
//  - 横幅は親に追従（width 100% / height auto・viewBox でスケール）。390px でも崩れず読める。
//  - 各図に role="img" + aria-label を付ける（figure + figcaption でも補強）。
//  - 図中ラベルは中立的な丁寧体。一貫例として「行=債務者区分 × 列=ステージ(S1/S2/S3)、値=ECL合計」を使う。

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
  // 引当が偏るステージ3を「注意色」で示す（状態色トークン）。
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
// 図1: 生データ（縦長）→ クロス集計表（行=債務者区分 × 列=ステージ、値=ECL合計）
//      引当がステージ3に偏ることが数字で一目で分かる。
// ════════════════════════════════════════════════════════════════════════════
export function PivotBeforeAfterDiagram() {
  // 縦長の生データを表す行（ダミーの濃淡バー）。
  const rawRows = Array.from({ length: 14 });
  return (
    <DiagramFrame
      title="ピボットの前後：縦長の生データ → クロス集計表"
      ariaLabel="左に約80行の縦長の生データ、右向きの矢印を挟んで、右に行が債務者区分・列がステージ S1 S2 S3・値が ECL 合計のクロス集計表。総計行と総計列があり、ステージ3（S3）の列に金額が偏っていることを示しています。"
    >
      <svg {...svgProps(600, 320)}>
        <ArrowDefs id="arrow-beforeafter" />

        {/* 左: 生データ（縦長・80行のイメージ） */}
        <text x="10" y="16" fill={C.textMuted} fontSize="12" fontWeight="bold">
          生データ（80 行）
        </text>
        <rect x="10" y="24" width="200" height="280" rx="6" fill={C.surface2} stroke={C.border} />
        {/* ヘッダ行 */}
        <rect x="10" y="24" width="200" height="18" rx="6" fill={C.surface3} />
        <text x="20" y="37" fill={C.textMuted} fontSize="9">
          支店 / 区分 / ステージ / ECL …
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
            <rect x="68" y={52 + i * 18} width="46" height="7" rx="2" fill={C.borderStrong} opacity="0.5" />
            <rect x="122" y={52 + i * 18} width="24" height="7" rx="2" fill={C.borderStrong} opacity="0.5" />
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
          markerEnd="url(#arrow-beforeafter)"
        />
        <text x="242" y="150" fill={C.accent} fontSize="10" fontWeight="bold" textAnchor="middle">
          集計
        </text>

        {/* 右: クロス集計表 */}
        <text x="278" y="16" fill={C.textMuted} fontSize="12" fontWeight="bold">
          クロス集計（値＝ECL 合計）
        </text>
        {/* 表のセル定義: 列 = ラベル列 + S1 S2 S3 + 総計 */}
        {(() => {
          const ox = 278;
          const oy = 30;
          const colX = [ox, ox + 96, ox + 146, ox + 196, ox + 250]; // 区分 / S1 / S2 / S3 / 総計
          const colW = [96, 50, 50, 54, 52];
          const rowY = [oy, oy + 30, oy + 56, oy + 82, oy + 110]; // ヘッダ / 正常 / 要注意 / 破綻懸念 / 総計
          const rowH = [30, 26, 26, 28, 26];
          const header = ['債務者区分', 'S1', 'S2', 'S3', '総計'];
          // 金額（百万円）。S3 に偏らせる。
          const data: [string, string, string, string, string][] = [
            ['正常先', '12', '—', '—', '12'],
            ['要注意先', '—', '85', '—', '85'],
            ['破綻懸念先', '—', '—', '640', '640'],
            ['総計', '12', '85', '640', '737'],
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
              // S3 列（index 3）の破綻懸念セルを注意色でハイライト。
              const isS3Hot = c === 3 && r === 2;
              const fillBg = isTotal ? C.surface2 : isS3Hot ? C.warnBg : C.surface;
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
                    x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] / 2}
                    y={rowY[yi] + rowH[yi] / 2 + 4}
                    fill={isS3Hot ? C.warn : isTotal ? C.text : c === 0 ? C.textMuted : C.text}
                    fontSize={c === 0 ? '10' : '11'}
                    fontWeight={isTotal || isS3Hot ? 'bold' : 'normal'}
                    textAnchor={c === 0 ? 'start' : 'middle'}
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
        <text x="278" y="178" fill={C.warn} fontSize="9.5">
          ※ 金額は百万円。引当（ECL）が S3（破綻懸念先）に
        </text>
        <text x="278" y="191" fill={C.warn} fontSize="9.5">
          　偏っていることが一目で分かります。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 図2: Excel リボン操作。[挿入] タブ → [ピボットテーブル] ボタンをハイライト。
//      ① セルを1つクリック → ② 挿入 → ③ ピボットテーブル → ④ 新規ワークシートで OK
// ════════════════════════════════════════════════════════════════════════════
export function PivotRibbonDiagram() {
  const tabs = ['ファイル', 'ホーム', '挿入', 'ページ', '数式', 'データ'];
  return (
    <DiagramFrame
      step={1}
      title="リボン操作：［挿入］→［ピボットテーブル］"
      ariaLabel="Excel のリボン UI を簡略化した図。手順は、1 表内のセルを1つクリック、2 挿入タブを選ぶ、3 ピボットテーブルボタンを押す、4 新規ワークシートで OK。挿入タブとピボットテーブルボタンが強調表示されています。"
    >
      <svg {...svgProps(600, 250)}>
        {/* リボンのタブ行 */}
        <rect x="0" y="0" width="600" height="28" fill={C.surface2} />
        {tabs.map((t, i) => {
          const active = t === '挿入';
          return (
            <g key={t}>
              {active && <rect x={10 + i * 72} y="0" width="64" height="28" fill={C.surface} />}
              {active && (
                <rect x={10 + i * 72} y="26" width="64" height="2" fill={C.accent} />
              )}
              <text
                x={10 + i * 72 + 32}
                y="18"
                fill={active ? C.accent : C.textMuted}
                fontSize="11"
                fontWeight={active ? 'bold' : 'normal'}
                textAnchor="middle"
              >
                {t}
              </text>
            </g>
          );
        })}
        {/* 挿入タブを指す手順② */}
        <text x="166" y="44" fill={C.accent} fontSize="10" fontWeight="bold" textAnchor="middle">
          ② 挿入
        </text>

        {/* リボン本体 */}
        <rect x="0" y="28" width="600" height="86" fill={C.surface} stroke={C.border} />
        {/* ピボットテーブルボタン（強調） */}
        <rect x="14" y="38" width="92" height="66" rx="6" fill={C.accentStrong} opacity="0.12" stroke={C.accent} strokeWidth="1.5" />
        {/* ボタン内の小さな表アイコン */}
        <rect x="48" y="48" width="24" height="22" rx="2" fill={C.surface} stroke={C.accent} />
        <line x1="48" y1="56" x2="72" y2="56" stroke={C.accent} strokeWidth="1" />
        <line x1="60" y1="48" x2="60" y2="70" stroke={C.accent} strokeWidth="1" />
        <text x="60" y="86" fill={C.accent} fontSize="10" fontWeight="bold" textAnchor="middle">
          ピボット
        </text>
        <text x="60" y="98" fill={C.accent} fontSize="10" fontWeight="bold" textAnchor="middle">
          テーブル
        </text>
        <text x="60" y="126" fill={C.accent} fontSize="10" fontWeight="bold" textAnchor="middle">
          ③ ここ
        </text>

        {/* 他のダミーボタン */}
        {['図', 'グラフ', 'スライサー'].map((b, i) => (
          <g key={b}>
            <rect x={120 + i * 80} y="42" width="68" height="58" rx="5" fill={C.surface2} stroke={C.border} />
            <text x={120 + i * 80 + 34} y="76" fill={C.textFaint} fontSize="10" textAnchor="middle">
              {b}
            </text>
          </g>
        ))}

        {/* 手順①: 表内セルを1つクリック（下にミニ表） */}
        <text x="10" y="160" fill={C.textMuted} fontSize="11" fontWeight="bold">
          ① 先に「表の中のセルを1つ」クリック（範囲選択は不要です）
        </text>
        {Array.from({ length: 4 }).map((_, r) =>
          Array.from({ length: 5 }).map((__, c) => {
            const selected = r === 2 && c === 2;
            return (
              <g key={`${r}-${c}`}>
                <rect
                  x={14 + c * 54}
                  y={170 + r * 18}
                  width="54"
                  height="18"
                  fill={selected ? C.okBg : r === 0 ? C.surface3 : C.surface}
                  stroke={selected ? C.accent : C.border}
                  strokeWidth={selected ? 1.5 : 0.5}
                />
                {r === 0 && (
                  <text x={14 + c * 54 + 27} y={183} fill={C.textMuted} fontSize="8" textAnchor="middle">
                    {['支店', '区分', 'ステージ', 'ECL', 'PD'][c]}
                  </text>
                )}
              </g>
            );
          }),
        )}
        <text x={14 + 2 * 54 + 27} y={170 + 2 * 18 + 13} fill={C.accent} fontSize="9" fontWeight="bold" textAnchor="middle">
          ●
        </text>
        <text x="300" y="218" fill={C.textMuted} fontSize="10">
          → 範囲が自動で入ります。④ 配置先は「新規ワークシート」を選んで OK。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 図3: 「ピボットテーブルのフィールド」ペイン。
//      上にフィールド一覧、下に4ボックス（フィルター/列/行/値）。ドラッグの矢印と役割ラベル。
// ════════════════════════════════════════════════════════════════════════════
export function PivotFieldPaneDiagram() {
  const fields = ['支店', '業種', '債務者区分', 'ステージ', 'EAD', 'ECL', '計上月'];
  return (
    <DiagramFrame
      step={2}
      title="フィールドの配置：一覧から4つのボックスへドラッグ"
      ariaLabel="ピボットテーブルのフィールドペインの図。上にフィールド一覧（支店・業種・債務者区分・ステージ・EAD・ECL・計上月）、下に4つのドロップ先ボックス、フィルター・列・行・値があります。債務者区分を行へ、ステージを列へ、ECL を値へドラッグする矢印が描かれ、各ボックスの役割が添えられています。"
    >
      <svg {...svgProps(600, 360)}>
        <ArrowDefs id="arrow-fieldpane" />
        <rect x="0" y="0" width="600" height="360" rx="8" fill={C.surface2} stroke={C.border} />
        <text x="14" y="22" fill={C.text} fontSize="12" fontWeight="bold">
          ピボットテーブルのフィールド
        </text>

        {/* フィールド一覧 */}
        <text x="14" y="42" fill={C.textMuted} fontSize="10">
          レポートに追加するフィールド：
        </text>
        {fields.map((f, i) => {
          const used = f === '債務者区分' || f === 'ステージ' || f === 'ECL';
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
        {/* 債務者区分 → 行 */}
        <path
          d="M214,109 C300,109 300,250 360,250"
          fill="none"
          stroke={C.accent}
          strokeWidth="2"
          strokeDasharray="4 3"
          markerEnd="url(#arrow-fieldpane)"
        />
        {/* ステージ → 列 */}
        <path
          d="M214,133 C320,133 320,196 360,196"
          fill="none"
          stroke={C.accent}
          strokeWidth="2"
          strokeDasharray="4 3"
          markerEnd="url(#arrow-fieldpane)"
        />
        {/* ECL → 値 */}
        <path
          d="M214,181 C300,181 300,304 360,304"
          fill="none"
          stroke={C.accent}
          strokeWidth="2"
          strokeDasharray="4 3"
          markerEnd="url(#arrow-fieldpane)"
        />

        {/* 4つのドロップ先ボックス */}
        {(() => {
          const boxes: { label: string; role: string; chip?: string; y: number }[] = [
            { label: 'フィルター', role: '表全体の絞り込み（例：計上月）', y: 96 },
            { label: '列', role: '横に並べる項目', chip: 'ステージ', y: 150 },
            { label: '行', role: '縦に並べる項目', chip: '債務者区分', y: 204 },
            { label: '値', role: '集計する数値', chip: 'ECL（合計）', y: 258 },
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
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 図4: 集計方法の変更。値を右クリック →［値フィールドの設定］→ 合計/個数/平均。
//      金額=合計、件数=個数、PD・LGD=平均 を併記。
// ════════════════════════════════════════════════════════════════════════════
export function PivotValueSettingsDiagram() {
  return (
    <DiagramFrame
      step={3}
      title="集計方法の変更：［値フィールドの設定］"
      ariaLabel="値フィールドの設定メニューのモック図。値を右クリックして値フィールドの設定を開き、合計・個数・平均から選びます。金額は合計、件数は個数、PD と LGD は平均が定番である旨を併記しています。"
    >
      <svg {...svgProps(600, 260)}>
        <ArrowDefs id="arrow-valset" />
        {/* 値ボックス（右クリック対象） */}
        <rect x="14" y="20" width="150" height="34" rx="5" fill={C.surface} stroke={C.borderStrong} />
        <text x="89" y="41" fill={C.text} fontSize="11" fontWeight="bold" textAnchor="middle">
          合計 / ECL
        </text>
        <text x="14" y="72" fill={C.textMuted} fontSize="10">
          値を右クリック →
        </text>

        {/* 右クリックの小メニュー */}
        <line x1="168" y1="37" x2="206" y2="37" stroke={C.accent} strokeWidth="2" markerEnd="url(#arrow-valset)" />
        <rect x="210" y="14" width="170" height="84" rx="6" fill={C.surface} stroke={C.borderStrong} />
        {['値の表示形式', '値フィールドの設定…', '並べ替え'].map((m, i) => {
          const hot = m === '値フィールドの設定…';
          return (
            <g key={m}>
              {hot && <rect x="212" y={16 + i * 26} width="166" height="26" fill={C.accent} opacity="0.14" />}
              <text x="222" y={33 + i * 26} fill={hot ? C.accent : C.text} fontSize="10.5" fontWeight={hot ? 'bold' : 'normal'}>
                {m}
              </text>
            </g>
          );
        })}

        {/* 設定ダイアログ: 集計方法の選択 */}
        <line x1="296" y1="100" x2="296" y2="126" stroke={C.accent} strokeWidth="2" markerEnd="url(#arrow-valset)" />
        <rect x="160" y="128" width="280" height="120" rx="6" fill={C.surface2} stroke={C.borderStrong} />
        <text x="174" y="148" fill={C.text} fontSize="11" fontWeight="bold">
          値フィールドの設定：集計方法
        </text>
        {[
          { label: '合計', sel: true },
          { label: '個数', sel: false },
          { label: '平均', sel: false },
          { label: '最大', sel: false },
        ].map((o, i) => (
          <g key={o.label}>
            <circle cx={184} cy={170 + i * 18} r="5" fill={o.sel ? C.accent : C.surface} stroke={o.sel ? C.accent : C.borderStrong} />
            {o.sel && <circle cx={184} cy={170 + i * 18} r="2" fill={C.surface} />}
            <text x={198} y={174 + i * 18} fill={C.text} fontSize="10.5" fontWeight={o.sel ? 'bold' : 'normal'}>
              {o.label}
            </text>
          </g>
        ))}

        {/* 使い分けの併記 */}
        <rect x="300" y="160" width="128" height="78" rx="5" fill={C.surface} stroke={C.border} />
        <text x="310" y="178" fill={C.textMuted} fontSize="10" fontWeight="bold">
          使い分けの目安
        </text>
        <text x="310" y="196" fill={C.text} fontSize="9.5">
          金額（EAD/ECL）＝合計
        </text>
        <text x="310" y="211" fill={C.text} fontSize="9.5">
          件数＝個数
        </text>
        <text x="310" y="226" fill={C.text} fontSize="9.5">
          PD・LGD＝平均
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 図5: 完成イメージ＋スライサー。出来上がったクロス集計＋支店/ステージのスライサー（ボタン切替）。
// ════════════════════════════════════════════════════════════════════════════
export function PivotResultDiagram() {
  return (
    <DiagramFrame
      step={4}
      title="完成イメージ：クロス集計＋スライサー"
      ariaLabel="完成したピボットの図。行が債務者区分、列がステージ S1 S2 S3、値が ECL 合計のクロス集計表に総計があり、右側に支店とステージをボタンで切り替えるスライサーが添えられています。"
    >
      <svg {...svgProps(600, 280)}>
        {/* 完成したクロス集計表（図1の右と整合） */}
        {(() => {
          const ox = 14;
          const oy = 20;
          const colX = [ox, ox + 96, ox + 146, ox + 196, ox + 246];
          const colW = [96, 50, 50, 50, 54];
          const header = ['債務者区分', 'S1', 'S2', 'S3', '総計'];
          const data: [string, string, string, string, string][] = [
            ['正常先', '12', '—', '—', '12'],
            ['要注意先', '—', '85', '—', '85'],
            ['破綻懸念先', '—', '—', '640', '640'],
            ['総計', '12', '85', '640', '737'],
          ];
          const rowH = 28;
          const cells: ReactNode[] = [];
          header.forEach((h, c) => {
            cells.push(
              <g key={`rh-${c}`}>
                <rect x={colX[c]} y={oy} width={colW[c]} height={rowH} fill={C.surface3} stroke={C.border} />
                <text
                  x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] / 2}
                  y={oy + 18}
                  fill={C.text}
                  fontSize={c === 0 ? '10' : '11'}
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
              const isS3Hot = c === 3 && r === 2;
              cells.push(
                <g key={`rd-${r}-${c}`}>
                  <rect
                    x={colX[c]}
                    y={y}
                    width={colW[c]}
                    height={rowH}
                    fill={isTotal ? C.surface2 : isS3Hot ? C.warnBg : C.surface}
                    stroke={C.border}
                  />
                  <text
                    x={c === 0 ? colX[c] + 6 : colX[c] + colW[c] / 2}
                    y={y + 18}
                    fill={isS3Hot ? C.warn : C.text}
                    fontSize={c === 0 ? '10' : '11'}
                    fontWeight={isTotal || isS3Hot ? 'bold' : 'normal'}
                    textAnchor={c === 0 ? 'start' : 'middle'}
                  >
                    {v}
                  </text>
                </g>,
              );
            });
          });
          return cells;
        })()}
        <text x="14" y="184" fill={C.textFaint} fontSize="9">
          金額は百万円（値＝ECL 合計）
        </text>

        {/* スライサー（支店・ステージ） */}
        <text x="320" y="34" fill={C.textMuted} fontSize="11" fontWeight="bold">
          スライサー（ボタンで絞り込み）
        </text>
        {/* 支店スライサー */}
        <rect x="320" y="44" width="130" height="100" rx="6" fill={C.surface} stroke={C.borderStrong} />
        <text x="330" y="60" fill={C.text} fontSize="10" fontWeight="bold">
          支店
        </text>
        {['大手町', '丸の内', '日本橋'].map((b, i) => {
          const on = i === 0;
          return (
            <g key={b}>
              <rect
                x={330}
                y={68 + i * 22}
                width="110"
                height="18"
                rx="3"
                fill={on ? C.accent : C.surface2}
                stroke={on ? C.accent : C.border}
                opacity={on ? 0.85 : 1}
              />
              <text
                x={385}
                y={80 + i * 22}
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
        {/* ステージスライサー */}
        <rect x="460" y="44" width="126" height="100" rx="6" fill={C.surface} stroke={C.borderStrong} />
        <text x="470" y="60" fill={C.text} fontSize="10" fontWeight="bold">
          ステージ
        </text>
        {['S1', 'S2', 'S3'].map((s, i) => {
          const on = i === 2;
          return (
            <g key={s}>
              <rect
                x={470}
                y={68 + i * 22}
                width="106"
                height="18"
                rx="3"
                fill={on ? C.accent : C.surface2}
                stroke={on ? C.accent : C.border}
                opacity={on ? 0.85 : 1}
              />
              <text
                x={523}
                y={80 + i * 22}
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
        <text x="320" y="166" fill={C.textMuted} fontSize="10">
          押した支店・ステージだけに表が即座に絞り込まれます。
        </text>
        <text x="320" y="182" fill={C.textFaint} fontSize="9">
          支店別・ステージ別の点検にそのまま使えます。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 図6: 「行・列・値・フィルター」4ボックスの役割を一枚で（テキストペインの補助・概念図）。
// ════════════════════════════════════════════════════════════════════════════
export function PivotBoxRolesDiagram() {
  const boxes = [
    { label: '行', desc: '縦に並べる', ex: '例：債務者区分', color: C.accent },
    { label: '列', desc: '横に並べる', ex: '例：ステージ', color: C.accent },
    { label: '値', desc: '集計する数値', ex: '例：ECL（合計）', color: C.ok },
    { label: 'フィルター', desc: '表全体を絞る', ex: '例：計上月', color: C.warn },
  ];
  return (
    <DiagramFrame
      title="4つのボックスの役割"
      ariaLabel="ピボットの4つのボックスの役割図。行は縦に並べる項目で例は債務者区分、列は横に並べる項目で例はステージ、値は集計する数値で例は ECL の合計、フィルターは表全体を絞る条件で例は計上月です。"
    >
      <svg {...svgProps(600, 130)}>
        {boxes.map((b, i) => {
          const x = 8 + i * 148;
          return (
            <g key={b.label}>
              <rect x={x} y="14" width="138" height="100" rx="8" fill={C.surface} stroke={b.color} strokeWidth="1.5" />
              <rect x={x} y="14" width="138" height="26" rx="8" fill={b.color} opacity="0.14" />
              <text x={x + 12} y="32" fill={b.color} fontSize="13" fontWeight="bold">
                {b.label}
              </text>
              <text x={x + 12} y="64" fill={C.text} fontSize="11">
                {b.desc}
              </text>
              <text x={x + 12} y="92" fill={C.textMuted} fontSize="10">
                {b.ex}
              </text>
            </g>
          );
        })}
      </svg>
    </DiagramFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 応用・実務（コンサル水準）の図。step バッジ無し・title のみ。
// ════════════════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────────────
// Pro図1: ETL フロー。複数ソース → クレンジング → アンピボット → 1テーブル → ピボット。
// ────────────────────────────────────────────────────────────────────────────
export function PivotProPowerQueryDiagram() {
  const sources = ['支店A.xlsx', '支店B.xlsx', '勘定系.csv'];
  return (
    <DiagramFrame
      title="データ準備（ETL）：複数ソース → 1 テーブル → ピボット"
      ariaLabel="ETL フローの図。左に3つの元ソース（支店A・支店B・勘定系）が並び、結合（append）でひとつに積まれ、クレンジングと列のアンピボット（横持ちを縦持ちに変換）を経て、整然とした1つのテーブルになり、最後にピボットへ流れます。各工程は右向きの矢印でつながっています。"
    >
      <svg {...svgProps(600, 230)}>
        <ArrowDefs id="arrow-pq" />

        {/* 左: 複数ソース */}
        <text x="10" y="16" fill={C.textMuted} fontSize="11" fontWeight="bold">
          複数ソース
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
        <line x1="130" y1="91" x2="166" y2="91" stroke={C.accent} strokeWidth="2.5" markerEnd="url(#arrow-pq)" />
        <text x="148" y="80" fill={C.accent} fontSize="9" fontWeight="bold" textAnchor="middle">
          結合
        </text>

        {/* 中: クレンジング＋アンピボット */}
        <rect x="170" y="42" width="150" height="98" rx="6" fill={C.surface} stroke={C.accent} strokeWidth="1.3" />
        <text x="245" y="60" fill={C.accent} fontSize="10.5" fontWeight="bold" textAnchor="middle">
          Power Query
        </text>
        <text x="182" y="80" fill={C.text} fontSize="9.5">
          ・結合 / マージ
        </text>
        <text x="182" y="96" fill={C.text} fontSize="9.5">
          ・クレンジング
        </text>
        <text x="182" y="112" fill={C.text} fontSize="9.5">
          ・列のアンピボット
        </text>
        <text x="182" y="128" fill={C.textMuted} fontSize="8.5">
          （横持ち→縦持ち）
        </text>

        {/* 矢印: → 1テーブル */}
        <line x1="324" y1="91" x2="360" y2="91" stroke={C.accent} strokeWidth="2.5" markerEnd="url(#arrow-pq)" />

        {/* 右: 1つの整然テーブル */}
        <rect x="364" y="34" width="140" height="114" rx="6" fill={C.surface2} stroke={C.ok} strokeWidth="1.3" />
        <rect x="364" y="34" width="140" height="16" rx="6" fill={C.okBg} />
        <text x="372" y="46" fill={C.ok} fontSize="9.5" fontWeight="bold">
          1 つのテーブル（整然）
        </text>
        {Array.from({ length: 5 }).map((_, r) => (
          <g key={r}>
            <line x1="372" y1={60 + r * 16} x2="496" y2={60 + r * 16} stroke={C.border} strokeWidth="0.5" />
            <rect x="372" y={64 + r * 16} width="34" height="6" rx="2" fill={C.borderStrong} opacity="0.5" />
            <rect x="412" y={64 + r * 16} width="34" height="6" rx="2" fill={C.borderStrong} opacity="0.5" />
            <rect x="452" y={64 + r * 16} width="40" height="6" rx="2" fill={C.ok} opacity="0.35" />
          </g>
        ))}

        {/* 矢印: → ピボット */}
        <line x1="434" y1="156" x2="434" y2="186" stroke={C.accent} strokeWidth="2.5" markerEnd="url(#arrow-pq)" />
        <text x="500" y="176" fill={C.accent} fontSize="10" fontWeight="bold" textAnchor="end">
          → ピボットへ
        </text>
        <text x="364" y="176" fill={C.textFaint} fontSize="9">
          更新ボタン 1 つで再現できる前処理。
        </text>
        <text x="364" y="190" fill={C.textFaint} fontSize="9">
          元データの追加にも自動で追従します。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図2: データモデル（リレーション）＋メジャー（加重平均・YoY）の概念図。
// ────────────────────────────────────────────────────────────────────────────
export function PivotProDataModelDaxDiagram() {
  return (
    <DiagramFrame
      title="データモデル＆DAX メジャー：リレーションと加重平均"
      ariaLabel="データモデルの概念図。明細テーブル（取引）が、支店マスタと債務者マスタにそれぞれ共通キーのリレーションで結ばれています。右側に2つのメジャー、加重平均 LGD は EAD で加重した平均（シグマ LGD かける EAD 割るシグマ EAD）、YoY は当期割る前年同期マイナス1、として明示計算する旨が示されています。"
    >
      <svg {...svgProps(600, 250)}>
        <ArrowDefs id="arrow-dax" />

        {/* マスタ: 支店 */}
        <rect x="14" y="20" width="120" height="56" rx="6" fill={C.surface2} stroke={C.border} />
        <rect x="14" y="20" width="120" height="16" rx="6" fill={C.surface3} />
        <text x="22" y="32" fill={C.textMuted} fontSize="9.5" fontWeight="bold">
          支店マスタ
        </text>
        <text x="22" y="52" fill={C.text} fontSize="9">
          支店コード（キー）
        </text>
        <text x="22" y="66" fill={C.textFaint} fontSize="9">
          支店名 / 地域
        </text>

        {/* マスタ: 債務者 */}
        <rect x="14" y="170" width="120" height="56" rx="6" fill={C.surface2} stroke={C.border} />
        <rect x="14" y="170" width="120" height="16" rx="6" fill={C.surface3} />
        <text x="22" y="182" fill={C.textMuted} fontSize="9.5" fontWeight="bold">
          債務者マスタ
        </text>
        <text x="22" y="202" fill={C.text} fontSize="9">
          債務者 ID（キー）
        </text>
        <text x="22" y="216" fill={C.textFaint} fontSize="9">
          区分 / 業種
        </text>

        {/* 明細（中央） */}
        <rect x="210" y="84" width="140" height="80" rx="6" fill={C.surface} stroke={C.accent} strokeWidth="1.4" />
        <rect x="210" y="84" width="140" height="18" rx="6" fill={C.accent} opacity="0.14" />
        <text x="220" y="97" fill={C.accent} fontSize="10" fontWeight="bold">
          明細（取引）
        </text>
        <text x="220" y="118" fill={C.text} fontSize="9">
          支店コード / 債務者 ID
        </text>
        <text x="220" y="133" fill={C.text} fontSize="9">
          ステージ / 計上月
        </text>
        <text x="220" y="148" fill={C.text} fontSize="9">
          EAD / PD / LGD / ECL
        </text>

        {/* リレーション線 */}
        <line x1="134" y1="48" x2="210" y2="104" stroke={C.accent} strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#arrow-dax)" />
        <line x1="134" y1="198" x2="210" y2="144" stroke={C.accent} strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#arrow-dax)" />
        <text x="150" y="78" fill={C.textMuted} fontSize="8.5">
          支店コードで結合
        </text>
        <text x="150" y="180" fill={C.textMuted} fontSize="8.5">
          債務者 ID で結合
        </text>

        {/* メジャー */}
        <rect x="372" y="34" width="214" height="80" rx="6" fill={C.surface} stroke={C.ok} strokeWidth="1.2" />
        <text x="382" y="52" fill={C.ok} fontSize="10" fontWeight="bold">
          メジャー：加重平均 LGD
        </text>
        <text x="382" y="72" fill={C.text} fontSize="9.5">
          ＝ Σ(LGD×EAD) ÷ Σ EAD
        </text>
        <text x="382" y="90" fill={C.textMuted} fontSize="9">
          単純平均（平均の平均）の
        </text>
        <text x="382" y="103" fill={C.textMuted} fontSize="9">
          誤りを避けて正しく集計。
        </text>

        <rect x="372" y="134" width="214" height="80" rx="6" fill={C.surface} stroke={C.accent} strokeWidth="1.2" />
        <text x="382" y="152" fill={C.accent} fontSize="10" fontWeight="bold">
          メジャー：YoY（前年比）
        </text>
        <text x="382" y="172" fill={C.text} fontSize="9.5">
          ＝ 当期 ÷ 前年同期 − 1
        </text>
        <text x="382" y="190" fill={C.textMuted} fontSize="9">
          タイムインテリジェンス：
        </text>
        <text x="382" y="203" fill={C.textMuted} fontSize="9">
          YoY / MoM / 累計 YTD / CAGR。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図3: 「値の表示形式」スモールマルチプル（金額/構成比/順位/累計）。
// ────────────────────────────────────────────────────────────────────────────
export function PivotProShowValuesDiagram() {
  // 共通の元データ（区分別 ECL 合計）。
  const rows = [
    { label: '正常先', amt: '12', pct: '2%', rank: '3', cum: '12' },
    { label: '要注意先', amt: '85', pct: '12%', rank: '2', cum: '97' },
    { label: '破綻懸念先', amt: '640', pct: '87%', rank: '1', cum: '737' },
  ];
  const panels: { title: string; key: 'amt' | 'pct' | 'rank' | 'cum'; hot?: boolean }[] = [
    { title: '金額（合計）', key: 'amt' },
    { title: '構成比（総計比）', key: 'pct', hot: true },
    { title: '順位', key: 'rank' },
    { title: '累計', key: 'cum' },
  ];
  return (
    <DiagramFrame
      title="「値の表示形式」：同じ集計を 4 つの見せ方で"
      ariaLabel="同一のクロス集計（債務者区分別の ECL 合計）を、4 つの値の表示形式で並べたスモールマルチプル。1つ目は金額、2つ目は総計に対する構成比、3つ目は順位、4つ目は累計です。同じ数値が、見せ方を変えるだけで構成比や順位として表せることを示しています。"
    >
      <svg {...svgProps(600, 200)}>
        {panels.map((p, pi) => {
          const px = 8 + pi * 148;
          return (
            <g key={p.title}>
              <rect x={px} y="14" width="138" height="172" rx="6" fill={C.surface} stroke={p.hot ? C.accent : C.border} strokeWidth={p.hot ? 1.4 : 1} />
              <rect x={px} y="14" width="138" height="22" rx="6" fill={p.hot ? C.accent : C.surface3} opacity={p.hot ? 0.16 : 1} />
              <text x={px + 69} y="29" fill={p.hot ? C.accent : C.text} fontSize="10" fontWeight="bold" textAnchor="middle">
                {p.title}
              </text>
              {rows.map((r, ri) => (
                <g key={r.label}>
                  <rect x={px + 6} y={44 + ri * 44} width="126" height="38" rx="4" fill={C.surface2} stroke={C.border} strokeWidth="0.5" />
                  <text x={px + 14} y={59 + ri * 44} fill={C.textMuted} fontSize="9">
                    {r.label}
                  </text>
                  <text x={px + 124} y={76 + ri * 44} fill={C.text} fontSize="13" fontWeight="bold" textAnchor="end">
                    {r[p.key]}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図4: ウォーターフォール（予算 → 各要因の増減 → 実績）。
// ────────────────────────────────────────────────────────────────────────────
export function PivotProBridgeDiagram() {
  // 予算 600 → 実績 737。価格(PD/LGD)+90、数量(残高)+60、ミックス(構成)-13。
  const baseY = 170; // 0 の基準線（描画上の底）
  const scale = 0.18; // 1 百万円あたりの高さ
  const start = 600;
  const steps = [
    { label: '予算', kind: 'total' as const, from: 0, to: start },
    { label: '価格', kind: 'up' as const, delta: 90 },
    { label: '数量', kind: 'up' as const, delta: 60 },
    { label: 'ミックス', kind: 'down' as const, delta: -13 },
    { label: '実績', kind: 'total' as const, from: 0, to: 737 },
  ];
  let running = 0;
  const colW = 84;
  const gap = 28;
  const bars = steps.map((s, i) => {
    const x = 30 + i * (colW + gap);
    let top: number;
    let h: number;
    let prevRunning = running;
    if (s.kind === 'total') {
      running = s.to;
      h = s.to * scale;
      top = baseY - h;
    } else {
      const next = running + s.delta;
      const hi = Math.max(running, next);
      const lo = Math.min(running, next);
      h = (hi - lo) * scale;
      top = baseY - hi * scale;
      running = next;
    }
    return { ...s, x, top, h, prevRunning, running };
  });
  return (
    <DiagramFrame
      title="差異の要因分解：ブリッジ（予算 → 実績）"
      ariaLabel="ウォーターフォール（ブリッジ）チャートの図。左の予算 600 百万円を起点に、価格要因でプラス 90、数量要因でプラス 60、ミックス要因でマイナス 13 と増減バーが積み上がり、右の実績 737 百万円につながります。予算と実績の差の中身が、価格・数量・ミックスに分解されて見える形です。"
    >
      <svg {...svgProps(600, 210)}>
        {/* 基準線 */}
        <line x1="20" y1={baseY} x2="580" y2={baseY} stroke={C.border} strokeWidth="1" />
        {bars.map((b, i) => {
          const isTotal = b.kind === 'total';
          const isUp = b.kind === 'up';
          const fill = isTotal ? C.accent : isUp ? C.okBg : C.warnBg;
          const stroke = isTotal ? C.accent : isUp ? C.ok : C.warn;
          const valText =
            b.kind === 'total' ? String(b.to) : `${(b.delta ?? 0) > 0 ? '+' : ''}${b.delta}`;
          return (
            <g key={b.label}>
              {/* つなぎの点線（前バーの天端から次バーへ） */}
              {i > 0 && (
                <line
                  x1={bars[i - 1].x + colW}
                  y1={isTotal ? b.top : baseY - b.prevRunning * scale}
                  x2={b.x}
                  y2={isTotal ? b.top : baseY - b.prevRunning * scale}
                  stroke={C.borderStrong}
                  strokeWidth="0.8"
                  strokeDasharray="3 2"
                />
              )}
              <rect
                x={b.x}
                y={b.top}
                width={colW}
                height={Math.max(b.h, 2)}
                rx="2"
                fill={fill}
                stroke={stroke}
                strokeWidth="1.2"
                opacity={isTotal ? 0.85 : 1}
              />
              <text
                x={b.x + colW / 2}
                y={b.top - 6}
                fill={isTotal ? C.text : stroke}
                fontSize="11"
                fontWeight="bold"
                textAnchor="middle"
              >
                {valText}
              </text>
              <text x={b.x + colW / 2} y={baseY + 16} fill={C.textMuted} fontSize="10" textAnchor="middle">
                {b.label}
              </text>
            </g>
          );
        })}
        <text x="20" y="196" fill={C.textFaint} fontSize="9">
          金額は百万円。差（+137）の中身を 価格 × 数量 × ミックス に分解しています。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図5: Top-N バー＋「その他」バケット＋寄与度。
// ────────────────────────────────────────────────────────────────────────────
export function PivotProTopNDiagram() {
  // 支店別 ECL（上位3＋その他）。
  const items = [
    { label: '大手町', val: 320, w: 320, other: false },
    { label: '丸の内', val: 180, w: 180, other: false },
    { label: '日本橋', val: 110, w: 110, other: false },
    { label: 'その他（5 支店）', val: 127, w: 127, other: true },
  ];
  const maxW = 320;
  const barMax = 250;
  return (
    <DiagramFrame
      title="Top-N＋「その他」集約と寄与度"
      ariaLabel="支店別 ECL の図。上位3支店（大手町・丸の内・日本橋）を長さの異なる横棒で表示し、残りの5支店を「その他」バケットにまとめています。右側には前年差への寄与度として、大手町がプラス方向に最も大きく効いている旨を示しています。"
    >
      <svg {...svgProps(600, 210)}>
        <text x="14" y="18" fill={C.textMuted} fontSize="11" fontWeight="bold">
          支店別 ECL：上位 3 ＋「その他」
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
                x="130"
                y={y + 4}
                width={Math.max(w, 4)}
                height="18"
                rx="3"
                fill={it.other ? C.surface3 : C.accent}
                stroke={it.other ? C.borderStrong : C.accent}
                opacity={it.other ? 1 : 0.85}
              />
              <text x={130 + Math.max(w, 4) + 8} y={y + 17} fill={C.text} fontSize="10" fontWeight="bold">
                {it.val}
              </text>
            </g>
          );
        })}
        {/* 寄与度の注記パネル */}
        <rect x="400" y="30" width="186" height="150" rx="6" fill={C.surface2} stroke={C.border} />
        <text x="412" y="48" fill={C.textMuted} fontSize="10" fontWeight="bold">
          前年差への寄与度
        </text>
        {[
          { l: '大手町', v: '+38', up: true },
          { l: '丸の内', v: '+12', up: true },
          { l: '日本橋', v: '−5', up: false },
          { l: 'その他', v: '+9', up: true },
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
          増加の主因は大手町と読み取れます。
        </text>
        <text x="14" y="200" fill={C.textFaint} fontSize="9">
          金額は百万円。［値フィルター］→［上位 N］＋残りを「その他」に畳んで集約。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図6: レポート接続（1スライサー→複数ピボット/グラフ）＋GETPIVOTDATA。
// ────────────────────────────────────────────────────────────────────────────
export function PivotProDeckLinkDiagram() {
  return (
    <DiagramFrame
      title="成果物連携：レポート接続と GETPIVOTDATA"
      ariaLabel="成果物連携の図。中央上の1つのスライサーが、レポート接続で下の3つの成果物（ピボット表・ピボットグラフ・サマリ表）を同時に絞り込みます。サマリ表は GETPIVOTDATA でピボットの特定セルを安定参照していることを示しています。"
    >
      <svg {...svgProps(600, 240)}>
        <ArrowDefs id="arrow-deck" />

        {/* スライサー（親） */}
        <rect x="234" y="14" width="132" height="48" rx="6" fill={C.surface} stroke={C.accent} strokeWidth="1.4" />
        <text x="300" y="32" fill={C.accent} fontSize="10.5" fontWeight="bold" textAnchor="middle">
          スライサー：支店
        </text>
        <rect x="246" y="40" width="50" height="14" rx="3" fill={C.accent} opacity="0.85" />
        <text x="271" y="51" fill={C.bg} fontSize="9" fontWeight="bold" textAnchor="middle">
          大手町
        </text>
        <rect x="304" y="40" width="50" height="14" rx="3" fill={C.surface2} stroke={C.border} />
        <text x="329" y="51" fill={C.textMuted} fontSize="9" textAnchor="middle">
          丸の内
        </text>

        {/* 接続線 → 3 つの成果物 */}
        <line x1="300" y1="62" x2="90" y2="100" stroke={C.accent} strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#arrow-deck)" />
        <line x1="300" y1="62" x2="300" y2="100" stroke={C.accent} strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#arrow-deck)" />
        <line x1="300" y1="62" x2="510" y2="100" stroke={C.accent} strokeWidth="1.6" strokeDasharray="4 3" markerEnd="url(#arrow-deck)" />
        <text x="300" y="84" fill={C.textMuted} fontSize="8.5" textAnchor="middle">
          レポート接続で同時に絞り込み
        </text>

        {/* 成果物1: ピボット表 */}
        <rect x="20" y="106" width="150" height="110" rx="6" fill={C.surface2} stroke={C.border} />
        <text x="95" y="124" fill={C.text} fontSize="10" fontWeight="bold" textAnchor="middle">
          ピボット表
        </text>
        {Array.from({ length: 4 }).map((_, r) => (
          <g key={r}>
            <line x1="32" y1={138 + r * 16} x2="158" y2={138 + r * 16} stroke={C.border} strokeWidth="0.5" />
            <rect x="32" y={142 + r * 16} width="50" height="6" rx="2" fill={C.borderStrong} opacity="0.5" />
            <rect x="118" y={142 + r * 16} width="38" height="6" rx="2" fill={C.accent} opacity="0.35" />
          </g>
        ))}

        {/* 成果物2: ピボットグラフ */}
        <rect x="225" y="106" width="150" height="110" rx="6" fill={C.surface2} stroke={C.border} />
        <text x="300" y="124" fill={C.text} fontSize="10" fontWeight="bold" textAnchor="middle">
          ピボットグラフ
        </text>
        {[40, 70, 30, 58].map((h, i) => (
          <rect key={i} x={245 + i * 30} y={200 - h} width="20" height={h} rx="2" fill={C.accent} opacity="0.7" />
        ))}
        <line x1="237" y1="200" x2="363" y2="200" stroke={C.border} strokeWidth="0.8" />

        {/* 成果物3: サマリ表（GETPIVOTDATA） */}
        <rect x="430" y="106" width="150" height="110" rx="6" fill={C.surface} stroke={C.ok} strokeWidth="1.2" />
        <text x="505" y="124" fill={C.ok} fontSize="10" fontWeight="bold" textAnchor="middle">
          サマリ表（デック用）
        </text>
        <text x="442" y="146" fill={C.text} fontSize="9">
          ＝GETPIVOTDATA(…)
        </text>
        <text x="442" y="164" fill={C.textMuted} fontSize="8.5">
          ピボットの特定セルを
        </text>
        <text x="442" y="177" fill={C.textMuted} fontSize="8.5">
          項目名で安定参照。
        </text>
        <text x="442" y="197" fill={C.textFaint} fontSize="8.5">
          動的タイトル＋
        </text>
        <text x="442" y="209" fill={C.textFaint} fontSize="8.5">
          PowerPoint へリンク貼り。
        </text>
      </svg>
    </DiagramFrame>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pro図7: QA チェックリスト＋「平均の平均」の誤り例（正誤対比）。
// ────────────────────────────────────────────────────────────────────────────
export function PivotProQADiagram() {
  const checks = [
    '総計が元データ合計と一致するか突合',
    'マージのキー重複による二重計上はないか',
    'フィルタの掛け忘れ・古いキャッシュはないか',
    'ピボット結果を手修正で上書きしていないか',
    '開く時に更新／更新ボタンの規律',
  ];
  return (
    <DiagramFrame
      title="監査・QA：チェックリストと「平均の平均」の誤り"
      ariaLabel="QA の図。左に5項目のチェックリスト（総計の突合、二重計上の確認、フィルタ漏れと古いキャッシュ、手修正の上書き、更新規律）。右に「平均の平均」の誤り例を正誤で対比し、LGD を単純平均すると誤り、EAD で加重した平均が正しい、と示しています。"
    >
      <svg {...svgProps(600, 220)}>
        {/* 左: チェックリスト */}
        <text x="14" y="18" fill={C.textMuted} fontSize="11" fontWeight="bold">
          QA チェックリスト
        </text>
        {checks.map((c, i) => (
          <g key={i}>
            <rect x="16" y={28 + i * 34} width="18" height="18" rx="4" fill={C.okBg} stroke={C.ok} strokeWidth="1.2" />
            <path d={`M20,${37 + i * 34} l3,4 l6,-7`} fill="none" stroke={C.ok} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <text x="42" y={41 + i * 34} fill={C.text} fontSize="10">
              {c}
            </text>
          </g>
        ))}

        {/* 右: 平均の平均 正誤対比 */}
        <rect x="360" y="22" width="226" height="84" rx="6" fill={C.surface} stroke={C.warn} strokeWidth="1.2" />
        <text x="372" y="40" fill={C.warn} fontSize="10" fontWeight="bold">
          × 誤り：LGD を単純平均
        </text>
        <text x="372" y="60" fill={C.text} fontSize="9.5">
          (40% + 60%) ÷ 2 ＝ 50%
        </text>
        <text x="372" y="78" fill={C.textMuted} fontSize="8.5">
          残高の大小を無視＝「平均の平均」。
        </text>
        <text x="372" y="93" fill={C.textMuted} fontSize="8.5">
          ポートフォリオの実態とずれます。
        </text>

        <rect x="360" y="118" width="226" height="86" rx="6" fill={C.surface} stroke={C.ok} strokeWidth="1.2" />
        <text x="372" y="136" fill={C.ok} fontSize="10" fontWeight="bold">
          ○ 正：EAD で加重平均
        </text>
        <text x="372" y="156" fill={C.text} fontSize="9.5">
          Σ(LGD×EAD) ÷ Σ EAD
        </text>
        <text x="372" y="174" fill={C.text} fontSize="9.5">
          ＝（40%×100 ＋ 60%×900）÷ 1000
        </text>
        <text x="372" y="190" fill={C.ok} fontSize="9.5" fontWeight="bold">
          ＝ 58%（実態に整合）
        </text>
      </svg>
    </DiagramFrame>
  );
}
