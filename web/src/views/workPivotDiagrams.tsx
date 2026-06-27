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
