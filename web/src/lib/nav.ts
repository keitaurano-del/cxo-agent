// ナビゲーションの判定ヘルパー（MC-76）。
// ダッシュボード（/）は配下に /today /feed /agents /usage を持つグループ。
// それら子パスにいる間も「ダッシュボード」ナビをアクティブ表示にしたいので、
// 他のトップ項目（/tasks /approvals /vault）以外をダッシュボードグループとして扱う。
const NON_DASHBOARD_PREFIXES = ['/tasks', '/approvals', '/vault'];

export function isDashboardPath(pathname: string): boolean {
  return !NON_DASHBOARD_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
