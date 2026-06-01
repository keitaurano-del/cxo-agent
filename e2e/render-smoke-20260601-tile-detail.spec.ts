// test-smoke: Apollo 全タイル クリック→詳細（MC-67 全タイル展開）2026-06-01
//   ダッシュボードの各タイルをクリックすると詳細ドロワー（内訳・関連情報）が開くことを確認。
//   対象: 俯瞰の KPI カード / 消費量の BigStat・内訳カード / ティックのカード。
//   併せて MC-67 の司令塔プロジェクトカード詳細が非退行であることを確認。
//   モバイル(390px) タップ + デスクトップ(1280px) の両 viewport。
//
// 認証: ?token=<MC_TOKEN> 初回アクセス → httpOnly Cookie 発行 → クリーン URL に 302。
// 浅く速くが原則。深い挙動検証は test-functional 領域。
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');

const TOKEN = (() => {
  const raw = readFileSync(path.join(REPO_ROOT, '.mc.env'), 'utf8');
  const m = raw.match(/MC_TOKEN\s*=\s*(.+)/);
  if (!m) throw new Error('MC_TOKEN not found in .mc.env');
  return m[1].trim();
})();

async function authedGoto(page: Page, urlPath: string) {
  const url = urlPath === '/' ? `/?token=${TOKEN}` : `${urlPath}?token=${TOKEN}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

// 詳細ドロワー（dialog）を取得（TileDetail / ProjectDetail とも role=dialog）。
function drawer(page: Page) {
  return page.getByRole('dialog');
}

test.describe('390px モバイル — 全タイル クリック→詳細', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('1. 俯瞰の KPI カードをタップ→指標詳細（内訳）が開く', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/');

    // KPI カード「進行中タスク」をタップ。aria-label 経由で安定取得。
    const kpi = page.getByRole('button', { name: '指標の詳細を開く: 進行中タスク' });
    await expect(kpi).toBeVisible();
    await kpi.click();

    // 詳細ドロワーが開き、種別「指標」と内訳見出しが見える。
    const d = drawer(page);
    await expect(d).toBeVisible();
    await expect(d.getByText('指標', { exact: true })).toBeVisible();
    await expect(d.getByRole('heading', { name: '進行中タスク' })).toBeVisible();
    await expect(d.getByText('プロジェクト別内訳', { exact: true })).toBeVisible();

    // Esc で閉じる。
    await page.keyboard.press('Escape');
    await expect(d).toHaveCount(0);

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('2. 消費量の BigStat / 内訳カードをタップ→トークン内訳が開く', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/usage');
    await expect(page.getByRole('heading', { name: 'プロジェクト別' })).toBeVisible();

    // BigStat「当日」をタップ。
    const bigStat = page.getByRole('button', { name: '当日の消費量内訳を開く' });
    await expect(bigStat).toBeVisible();
    await bigStat.click();

    const d = drawer(page);
    await expect(d).toBeVisible();
    await expect(d.getByText('トークン内訳', { exact: true })).toBeVisible();
    // 内訳の stat（合計・出力・入力）が出る。
    await expect(d.getByText('合計', { exact: true })).toBeVisible();
    await expect(d.getByText('出力', { exact: true })).toBeVisible();

    // ヘッダの閉じるボタン（X）で閉じる。ヘッダ内に絞って取得（背面オーバーレイと区別）。
    await d.getByRole('button', { name: '閉じる' }).last().click();
    await expect(d).toHaveCount(0);

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

test.describe('1280px デスクトップ — 非退行 + ティック', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('3. MC-67 プロジェクトカード詳細が非退行（内訳＋関連タスク）', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/');

    // 最初のプロジェクトカード（aria-label 前方一致）をクリック。
    const projCard = page.getByRole('button', { name: /^プロジェクト詳細を開く: / }).first();
    await expect(projCard).toBeVisible();
    await projCard.click();

    const d = drawer(page);
    await expect(d).toBeVisible();
    // MC-67 の内訳・関連タスク見出し。
    await expect(d.getByText('内訳', { exact: true })).toBeVisible();
    await expect(d.getByText('関連タスク', { exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(d).toHaveCount(0);

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('4. ティックのカードをクリック→ティック詳細が開く（記録がある場合）', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/ticks');

    // ティック記録があればカードをクリックして詳細を確認。無ければ空状態を許容。
    const tickCard = page.getByRole('button', { name: /^ティックの詳細を開く: / }).first();
    const count = await tickCard.count();
    if (count > 0) {
      await tickCard.click();
      const d = drawer(page);
      await expect(d).toBeVisible();
      await expect(d.getByText('ティック', { exact: true })).toBeVisible();
      await expect(d.getByText('概要', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(d).toHaveCount(0);
    } else {
      // 空状態（ティック未記録）でもページが壊れていないことだけ確認。
      await expect(page.getByRole('heading', { name: 'ティック' })).toBeVisible();
    }

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
