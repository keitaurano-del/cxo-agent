// ライブデータ取得フック。
//
// - 個別エンドポイントごとに fetch（1 つ失敗しても他画面は描画継続）。
// - 12 秒ポーリング。
// - /api/stream の EventSource を購読し、メッセージ受信で即再フェッチ trigger。
//   （Phase 3 で watch 接続されるまでは ping のみ届く。受け皿として繋いでおく）
//
// 使い方:
//   const { data, error, loading, refetch } = useLiveResource<Overview>('/api/overview');

import { useCallback, useEffect, useRef, useState } from 'react';

/** 直前のシリアライズ済みレスポンスを保持（内容不変なら setData をスキップして再レンダリングを抑制）。 */

const POLL_INTERVAL_MS = 12000;

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export interface LiveResource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** 直近の成功フェッチ時刻（ISO）。null は未取得。 */
  fetchedAt: string | null;
  refetch: () => void;
}

/**
 * 単一エンドポイントを購読する。
 * @param path  例 '/api/overview'
 * @param liveTick  SSE 由来の再フェッチトリガー（useLiveStream の値を渡す）
 */
export function useLiveResource<T>(path: string, liveTick = 0): LiveResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [manualTick, setManualTick] = useState(0);

  // 進行中フェッチをキャンセルできるよう保持。
  const abortRef = useRef<AbortController | null>(null);
  // 直前のシリアライズ結果。ref なので useCallback の deps に含めない。
  const prevJsonRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const json = await fetchJson<T>(path, ctrl.signal);
      if (ctrl.signal.aborted) return;
      // データが変わっていなければ setData をスキップ → 再レンダリング抑制。
      // テキスト選択が消える根本原因（12 秒ポーリング + SSE トリガーによる不要な再描画）を防ぐ。
      const newJson = JSON.stringify(json);
      if (newJson === prevJsonRef.current) {
        if (!ctrl.signal.aborted) setLoading(false);
        return;
      }
      prevJsonRef.current = newJson;
      setData(json);
      setError(null);
      setFetchedAt(new Date().toISOString());
    } catch (e) {
      if (ctrl.signal.aborted) return;
      // 部分劣化: エラーは保持しつつ既存 data は消さない（前回値を表示し続ける）。
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [path]);

  // 初回 + ポーリング + 手動 + SSE トリガーで再フェッチ。
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load, manualTick, liveTick]);

  const refetch = useCallback(() => setManualTick((n) => n + 1), []);

  return { data, error, loading, fetchedAt, refetch };
}

/** SSE が運ぶリソース種別。backend watch.ts の ChangeType と一致させる。 */
export type LiveResourceType = 'agents' | 'tasks' | 'narrative';

/** 種別ごとの再フェッチカウンタ。各 useLiveResource は関係する種別の値だけ購読する。 */
export type LiveTicks = Record<LiveResourceType, number>;

const ZERO_TICKS: LiveTicks = { agents: 0, tasks: 0, narrative: 0 };

/**
 * /api/stream の EventSource を購読し、種別ごとの再フェッチカウンタを返す。
 *
 * - backend は named event `update`（data に `{types:[...], ts}`）を送る。
 *   `es.onmessage` は **無名 message（= ping）だけ** を拾うため、named event の
 *   `update` は `addEventListener('update', ...)` でないと拾えない（これが MC-33 の核）。
 * - ping（25 秒間隔の keep-alive）では tick しない。無駄な再フェッチを避ける。
 * - `update` の data.types を見て、該当種別のカウンタだけインクリメントする。
 *   → views は自分が依存するリソースが変わった時だけ再フェッチする。
 * - SSE が落ちても useLiveResource 側の 12 秒ポーリングが更新を継続する。
 */
export function useLiveStream(): { ticks: LiveTicks; connected: boolean } {
  const [ticks, setTicks] = useState<LiveTicks>(ZERO_TICKS);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: number | undefined;
    let closed = false;

    const bumpTypes = (types: LiveResourceType[]) => {
      setTicks((prev) => {
        const next = { ...prev };
        for (const t of types) {
          if (t === 'agents' || t === 'tasks' || t === 'narrative') next[t] += 1;
        }
        return next;
      });
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/stream');
      es.onopen = () => setConnected(true);
      // named event 'update' のみ再フェッチトリガー。
      // 無名 message（ping）は onmessage に来るが、ここでは tick しない（無駄フェッチ抑制）。
      es.addEventListener('update', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { types?: string[] };
          const types = (data.types ?? []).filter(
            (t): t is LiveResourceType =>
              t === 'agents' || t === 'tasks' || t === 'narrative',
          );
          // types が空 or 未知のみの場合は安全側で全種別を bump。
          bumpTypes(types.length > 0 ? types : ['agents', 'tasks', 'narrative']);
        } catch {
          // data 解析失敗時も取りこぼさないよう全種別 bump。
          bumpTypes(['agents', 'tasks', 'narrative']);
        }
      });
      es.onerror = () => {
        setConnected(false);
        es?.close();
        // 自動再接続（EventSource 標準の再接続に任せず明示制御）。
        if (!closed) retryTimer = window.setTimeout(connect, 5000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      es?.close();
    };
  }, []);

  return { ticks, connected };
}
