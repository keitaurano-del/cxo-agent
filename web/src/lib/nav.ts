// ナビゲーションの判定ヘルパー（MC-76 / MC-162）。
// ダッシュボード（/）は配下に /today /feed /agents /activity /plan-usage を持つグループ。
// それら子パスにいる間も「ダッシュボード」ナビをアクティブ表示にしたいので、
// 許可リスト方式でダッシュボード子パスを明示する（MC-162: 否定リスト方式を廃止）。
// 新しいトップレベルルートを追加した時に自動でダッシュ点灯しないよう安全側に倒す。
const DASHBOARD_PREFIXES = ['/', '/today', '/feed', '/agents', '/activity', '/plan-usage', '/news'];

export function isDashboardPath(pathname: string): boolean {
  return DASHBOARD_PREFIXES.some(
    (prefix) => prefix === '/'
      ? pathname === '/'
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
