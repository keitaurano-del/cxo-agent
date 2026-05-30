/** @type {import('tailwindcss').Config} */
// 配色は src/index.css の CSS 変数 (--mc-*) を単一ソースにする。
// ここでは tailwind ユーティリティ（bg-*, text-* 等）から同じ変数を参照するだけ。
// ハードコード hex はこのファイルに書かない（designer が CSS 変数だけ差し替えれば全体に反映）。
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--mc-bg)',
        surface: 'var(--mc-surface)',
        'surface-2': 'var(--mc-surface-2)',
        'surface-3': 'var(--mc-surface-3)',
        border: 'var(--mc-border)',
        'border-strong': 'var(--mc-border-strong)',
        text: 'var(--mc-text)',
        'text-muted': 'var(--mc-text-muted)',
        'text-faint': 'var(--mc-text-faint)',
        accent: 'var(--mc-accent)',
        'accent-strong': 'var(--mc-accent-strong)',
        active: 'var(--mc-active)',
        'active-bg': 'var(--mc-active-bg)',
        idle: 'var(--mc-idle)',
        'idle-bg': 'var(--mc-idle-bg)',
        done: 'var(--mc-done)',
        'done-bg': 'var(--mc-done-bg)',
        never: 'var(--mc-never)',
        'never-bg': 'var(--mc-never-bg)',
        stalled: 'var(--mc-stalled)',
        'stalled-bg': 'var(--mc-stalled-bg)',
        blocked: 'var(--mc-blocked)',
        'blocked-bg': 'var(--mc-blocked-bg)',
        review: 'var(--mc-review)',
        'review-bg': 'var(--mc-review-bg)',
      },
    },
  },
  plugins: [],
};
