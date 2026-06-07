// useNavOrder — ナビ並び順をサーバ保存して端末横断同期するフック（MC-158）。
//
// サイドメニュー（NAV）・ダッシュサブタブ（DASH_TABS）の両方で使う。配列1つで
// desktop/mobile 両画面を描くため、並び順を1つ持てば両方に効く。
//
// 動作:
//  - マウント時に GET /api/nav-order して保存順を読む。
//  - default 項目集合とマージ: 保存順に在る default 項目をその順で先頭に並べ、
//    保存順に無い default 項目（新規追加されたナビ）は default 順で末尾に足す。
//    default に無い項目（削除済み）は捨てる。保存値を盲信して項目が消える/重複
//    するのを防ぐ。default 配列が「正準の項目集合＋初期順」。
//  - reorder（ドラッグ確定）で順序を更新し、POST /api/nav-order { key, order } で保存。
//
// 認証: same-origin fetch（ブラウザが mc_token Cookie を自動付与）。失敗時は
// default 順で動作継続（fail-soft、ナビが消えない）。

import { useCallback, useEffect, useState } from 'react';

/** 並び順を持つキー。サーバの NAV_KEYS と一致させる。 */
export type NavOrderKey = 'sidebar' | 'dashboard';

/** 並べ替え対象は最低限 `to`（一意キー兼遷移先）を持つ。 */
interface HasTo {
  to: string;
}

type NavOrderResponse = Partial<Record<NavOrderKey, string[]>>;

/**
 * 保存順（order）と default 項目（defaults）をマージして、表示用の順序付き配列を返す。
 * - order に在る default 項目 → order の順で先頭に。
 * - order に無い default 項目 → default の順で末尾に。
 * - default に無い order 項目 → 捨てる。
 */
export function mergeOrder<T extends HasTo>(defaults: T[], order: string[]): T[] {
  const byTo = new Map(defaults.map((d) => [d.to, d]));
  const used = new Set<string>();
  const merged: T[] = [];
  for (const to of order) {
    const item = byTo.get(to);
    if (item && !used.has(to)) {
      merged.push(item);
      used.add(to);
    }
  }
  // 保存順に無い default 項目を default 順で末尾追加。
  for (const d of defaults) {
    if (!used.has(d.to)) merged.push(d);
  }
  return merged;
}

interface UseNavOrderResult<T> {
  /** マージ済みの表示順（初期は default 順、GET 完了で保存順反映）。 */
  items: T[];
  /** ドラッグ確定で呼ぶ。新しい順序を適用してサーバ保存する。 */
  reorder: (next: T[]) => void;
}

export function useNavOrder<T extends HasTo>(
  key: NavOrderKey,
  defaults: T[],
): UseNavOrderResult<T> {
  const [order, setOrder] = useState<string[] | null>(null);

  // マウント時に保存順を読む。失敗時は null のまま（= default 順で表示）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/nav-order');
        if (!res.ok) return;
        const data = (await res.json()) as NavOrderResponse;
        const saved = data[key];
        if (!cancelled && Array.isArray(saved)) setOrder(saved);
      } catch {
        // fail-soft: default 順で続行。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const items = order === null ? defaults : mergeOrder(defaults, order);

  const reorder = useCallback(
    (next: T[]) => {
      const nextOrder = next.map((n) => n.to);
      setOrder(nextOrder);
      // 楽観更新済み。保存失敗は次回 GET で復元されるため握りつぶす。
      void fetch('/api/nav-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, order: nextOrder }),
      }).catch(() => {
        /* fail-soft */
      });
    },
    [key],
  );

  return { items, reorder };
}
