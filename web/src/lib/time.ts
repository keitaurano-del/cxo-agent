// 相対時刻ユーティリティ（「たった今 / N分前 / N時間前」）。中立的な丁寧体。

export function relativeTime(iso?: string | null): string {
  if (!iso) return '活動なし';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '不明';
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 'たった今';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return 'たった今';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}日前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}か月前`;
  return `${Math.floor(month / 12)}年前`;
}

/** YYYY-MM-DD HH:mm 形式（ツールチップ等の正確な時刻表示用）。 */
export function absoluteTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}
