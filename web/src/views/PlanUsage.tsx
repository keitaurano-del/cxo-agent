// Claude 使用量ビュー（MC-122）— GET /api/claude-usage（サーバ側 180 秒キャッシュ）。
// 各 Claude アカウント（この箱 / 旧箱）の「現在のセッション(5時間) / 週間(すべてのモデル) /
// 週間(Sonnet)」の使用率(%) とリセット時刻を、アカウント毎のカードで横バー表示する。
// 取得不可のアカウントは「使用量を取得できませんでした」を表示する（全体は落とさない）。
//
// 自動更新は 90 秒間隔（サーバ側 180 秒キャッシュのため実フェッチは抑制される）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ResourceState } from '../components/ui';
import { relativeTime } from '../lib/time';
import type { ClaudeAccountUsage, ClaudeUsageSummary, UsageBar } from '../lib/types';

// サーバ側 180 秒キャッシュなので、これより短くしても実フェッチは増えない。
const REFRESH_INTERVAL_MS = 90 * 1000;

/** resets_at の ISO 文字列を「あと N時間M分」または「あと N分」に整形する。 */
function formatReset(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return null;
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'まもなくリセットされます';

  const totalMin = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;

  if (days > 0) {
    return hours > 0 ? `あと${days}日${hours}時間でリセット` : `あと${days}日でリセット`;
  }
  if (hours > 0) {
    return minutes > 0 ? `あと${hours}時間${minutes}分でリセット` : `あと${hours}時間でリセット`;
  }
  return `あと${minutes}分でリセット`;
}

/** 1 本の使用率バー（ラベル + バー + 「N% 使用済み」 + リセット）。 */
function UsageBarRow({ label, bar }: { label: string; bar: UsageBar }) {
  const hasData = bar.pct !== null;
  const pct = bar.pct ?? 0;
  const reset = formatReset(bar.resetsAt);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        {hasData ? (
          <span className="text-xs font-semibold tabular-nums text-text">
            {Math.round(pct)}% 使用済み
          </span>
        ) : (
          <span className="text-xs text-text-faint">データなし</span>
        )}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={hasData ? Math.round(pct) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} 使用率`}
      >
        {hasData && (
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
          />
        )}
      </div>
      {hasData && reset && <span className="text-[11px] text-text-faint">{reset}</span>}
    </div>
  );
}

/** 1 アカウント分のカード。 */
function AccountCard({ account }: { account: ClaudeAccountUsage }) {
  // 取得不可（前回値も無い）の判定: すべてのバーが null かつ error 付き。
  const noData =
    account.error &&
    account.session.pct === null &&
    account.weekAll.pct === null &&
    (account.weekSonnet === null || account.weekSonnet.pct === null);

  return (
    <div className="rounded-xl border border-border bg-surface px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text">{account.label}</div>
          {account.email && (
            <div className="truncate text-[11px] text-text-muted">{account.email}</div>
          )}
        </div>
        {account.tier && (
          <span className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
            {account.tier}
          </span>
        )}
      </div>

      {noData ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-3 text-xs text-text-muted">
          使用量を取得できませんでした。
          {account.error && <span className="mt-1 block text-text-faint">{account.error}</span>}
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <UsageBarRow label="現在のセッション（5時間）" bar={account.session} />
          <UsageBarRow label="週間（すべてのモデル）" bar={account.weekAll} />
          {account.weekSonnet && (
            <UsageBarRow label="週間（Sonnet）" bar={account.weekSonnet} />
          )}
          {account.weekOpus && <UsageBarRow label="週間（Opus）" bar={account.weekOpus} />}

          {/* 前回値を表示しつつ最新取得に失敗している場合の注記（部分劣化）。 */}
          {account.error && (
            <div className="text-[11px] text-text-faint">
              {account.error}（前回取得した値を表示しています）
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PlanUsage() {
  const [data, setData] = useState<ClaudeUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/claude-usage', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for /api/claude-usage`);
      const json = (await res.json()) as ClaudeUsageSummary;
      if (ctrl.signal.aborted) return;
      setData(json);
      setError(null);
      setFetchedAt(new Date().toISOString());
    } catch (e) {
      if (ctrl.signal.aborted) return;
      // 部分劣化: エラーは保持しつつ既存 data は消さない。
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Claude 使用量" subtitle="各アカウントのプラン使用率" fetchedAt={fetchedAt} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <ResourceState loading={loading} error={error} hasData={!!data}>
          {data && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {data.accounts.map((account) => (
                  <AccountCard key={account.key} account={account} />
                ))}
              </div>
              <div className="text-[11px] text-text-faint">
                取得時刻: {relativeTime(data.generatedAt)}
                {data.cached ? '・キャッシュ済み' : '・最新取得'}
              </div>
            </div>
          )}
        </ResourceState>
      </div>
    </div>
  );
}
