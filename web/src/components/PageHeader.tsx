// 各ビュー共通のページヘッダ。
// 2026-06-27 Keita 指示:
//  - タイトル/サブタイトルの文字は表示しない（サイドメニューと重複のため）。
//  - さらに、中身（右側の操作ボタン・最終更新）が無いページではヘッダ帯自体を描画せず、
//    上部に空きスペース（折りたたみ矢印だけの帯）を残さない。
//  - title は a11y 用に <header aria-label> へ残す。
// 元に戻すには、従来のタイトル/サブタイトル/折りたたみトグルの UI を復活させる。
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  right,
}: {
  title: string;
  // 後方互換のため型は残すが、表示はしない（呼び出し側の subtitle / fetchedAt は無視される）。
  subtitle?: string;
  fetchedAt?: string | null;
  right?: ReactNode;
}) {
  // 「最終更新」表示は廃止（2026-07-20 Keita）。操作ボタンが無いページはヘッダ帯ごと省略して空帯を作らない。
  if (right == null) return null;

  return (
    <header
      aria-label={title}
      className="sticky top-0 z-10 flex flex-wrap items-center justify-end gap-3 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur md:px-6"
    >
      {right}
    </header>
  );
}
