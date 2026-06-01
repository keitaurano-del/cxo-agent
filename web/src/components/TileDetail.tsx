// TileDetail（MC-67 一般化）— ダッシュボードの任意タイル（カード）のドリルダウン詳細。
// MC-67 の ProjectDetail のドロワー作法を一般化した汎用版:
//   - createPortal で body 直下、fixed inset-0 z-50、右スライド(md:w-[34rem])/モバイル全幅
//   - 背面オーバーレイ button、Esc クローズ＋背面スクロールロック、上端に accent の border
//   - 本文 overflow-y-auto
// 各タイルは「種類に応じた内訳（stat 行）」＋「関連情報（related 行・任意クリック）」を渡す。
//
// デザイン制約: ハードコード hex 禁止（既存トークン/CSS 変数のみ）、UI chrome は SVG アイコンのみ、
//   文言は中立的な丁寧体、モバイル 390px で横溢れ 0、タップ領域は十分（min-h で確保）。

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRightIcon, CloseIcon } from './icons';

/** 内訳の 1 行（ラベル＋値、任意でアクセント色ドット）。 */
export interface TileStat {
  key: string;
  label: string;
  value: ReactNode;
  /** 値や凡例の色（CSS 変数）。指定時はドットを表示。 */
  color?: string;
  /** 補足（小さく下に出す）。 */
  sub?: string;
}

/** 関連情報の 1 行（任意でクリック可能）。 */
export interface TileRelated {
  key: string;
  /** 行頭の小さな識別子（タスク ID 等。任意）。 */
  tag?: string;
  /** バッジ等（任意）。 */
  badges?: ReactNode;
  /** 本文。 */
  title: string;
  /** クリックハンドラ（指定時のみクリック可能＝chevron 表示）。 */
  onClick?: () => void;
}

export interface TileSection {
  heading: string;
  /** 内訳カード（グリッド）。 */
  stats?: TileStat[];
  /** 関連情報のリスト。 */
  related?: TileRelated[];
  /** どちらも無い時の空表示文言。 */
  emptyText?: string;
  /** 自由記述（プレーンテキスト段落）。 */
  note?: string;
}

export interface TileDetailProps {
  /** null の間は何も描画しない（閉じている状態）。 */
  open: boolean;
  onClose: () => void;
  /** ヘッダ上段の種別ラベル（例: 「指標」「消費量」「ティック」）。 */
  kindLabel: string;
  /** ヘッダ見出し（タイルの名前）。 */
  title: string;
  /** 上端ボーダー・ドットのアクセント色（CSS 変数）。 */
  accent?: string;
  sections: TileSection[];
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-faint">
      {children}
    </h3>
  );
}

/** 汎用ドリルダウン詳細ドロワー。open が false の間は何も描画しない。 */
export function TileDetail({
  open,
  onClose,
  kindLabel,
  title,
  accent,
  sections,
}: TileDetailProps) {
  // Esc クローズ + 背面スクロールロック（ProjectDetail と同じ作法）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const accentColor = accent ?? 'var(--mc-accent)';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`詳細: ${title}`}
    >
      {/* 背面オーバーレイ */}
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      {/* ドロワー本体: モバイルは全幅、md 以上は右スライドのパネル */}
      <div
        className="relative flex h-full w-full max-w-full flex-col border-l border-border bg-bg shadow-xl md:w-[34rem]"
        style={{ borderTop: `3px solid ${accentColor}` }}
      >
        {/* ヘッダ */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <span
              className="inline-flex items-center gap-2 text-[11px] text-text-faint"
              role="status"
              aria-label={`種別: ${kindLabel}`}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: accentColor }}
                aria-hidden
              />
              {kindLabel}
            </span>
            <h2 className="mt-1 break-words text-[15px] font-bold leading-snug text-text">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="shrink-0 rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {sections.map((section, i) => {
            const hasStats = section.stats && section.stats.length > 0;
            const hasRelated = section.related && section.related.length > 0;
            return (
              <section key={`${section.heading}-${i}`} className={i > 0 ? 'mt-5' : undefined}>
                <SectionHeading>{section.heading}</SectionHeading>

                {section.note && (
                  <p className="mb-2 break-words text-[12px] leading-relaxed text-text-muted">
                    {section.note}
                  </p>
                )}

                {hasStats && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {section.stats!.map((s) => (
                      <div
                        key={s.key}
                        className="rounded-lg border border-border bg-surface px-3 py-2.5"
                      >
                        <div className="flex items-center gap-1.5">
                          {s.color && (
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ background: s.color }}
                              aria-hidden
                            />
                          )}
                          <span className="text-[11px] text-text-muted">{s.label}</span>
                        </div>
                        <div
                          className="mt-1 text-lg font-semibold tabular-nums"
                          style={{ color: s.color ?? 'var(--mc-text)' }}
                        >
                          {s.value}
                        </div>
                        {s.sub && (
                          <div className="mt-0.5 text-[10px] text-text-faint">{s.sub}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {hasRelated && (
                  <ul className="space-y-2">
                    {section.related!.map((r) => {
                      const inner = (
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            {r.tag && (
                              <span className="font-mono text-[10px] text-text-faint">{r.tag}</span>
                            )}
                            {r.badges}
                          </div>
                          <p className="mt-1 break-words text-[13px] leading-snug text-text">
                            {r.title}
                          </p>
                        </div>
                      );
                      return (
                        <li key={r.key}>
                          {r.onClick ? (
                            <button
                              type="button"
                              onClick={r.onClick}
                              className="group flex min-h-[44px] w-full items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                              aria-label={`詳細を開く: ${r.title}`}
                            >
                              {inner}
                              <span
                                className="mt-0.5 shrink-0 text-text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent"
                                aria-hidden
                              >
                                <ChevronRightIcon width={16} height={16} />
                              </span>
                            </button>
                          ) : (
                            <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
                              {inner}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {!hasStats && !hasRelated && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-faint">
                    {section.emptyText ?? '表示できる情報がありません。'}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
