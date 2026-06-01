// test-smoke: Apollo ターミナル「ターミナルを開始」ボタン（MC-100）生死確認 2026-06-01
//   (1) バックエンド稼働中（ready=true）はボタン非表示・iframe 表示（実サーバ status を使用）
//   (2) 切断状態（status を down にモック）は iframe 非表示・「ターミナルを開始」ボタン表示
//   (3) ボタン押下 → POST /api/terminal/start（モック）→ status が ready に切替 → iframe 再表示
//   (4) start 失敗時はエラー文言を表示
//   (5) 390px 横スクロール無し / 1280px 回帰
//
// 注意: 実 tmux main / ttyd を絶対に壊さないため、切断系のテストは /api/terminal/status と
//   /api/terminal/start を page.route で canned レスポンスにすげ替える。実サーバの tmux/systemctl
//   には一切触れない。サーバ側ロジック（has-session 判定・別名セッション作成・冪等 no-op・本番
//   main 非破壊）は別名セッション mc100test を使った実コード検証で別途確認済み。
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(REPO_ROOT, 'docs', 'render-screenshots', 'smoke');

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

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth, document.body.scrollWidth) - el.clientWidth;
  });
}

const READY = {
  tmuxSession: true,
  ttydService: true,
  ttydReachable: true,
  ready: true,
  target: 'main',
  service: 'apollo-terminal.service',
};
const DOWN = { ...READY, tmuxSession: false, ttydReachable: false, ready: false };

/** /api/terminal/status を canned JSON にすげ替える。 */
async function stubStatus(page: Page, body: object) {
  await page.route('**/api/terminal/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('390px モバイル', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('1. 稼働中はボタン非表示・iframe 表示（実サーバ status）', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // 実サーバの status（main 稼働中なので ready=true が返る前提）。
    await authedGoto(page, '/terminal-view');

    // 画像添付ツールバーは MC-95 のまま共存。
    await expect(page.getByRole('button', { name: '画像を選択' })).toBeVisible();
    // ready なので iframe が出て、開始ボタンは出ない。
    await expect(page.locator('iframe[title="Apollo ターミナル"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'ターミナルを開始' })).toHaveCount(0);

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);
    await page.screenshot({ path: path.join(SHOT_DIR, '390-terminal-start-ready.png') });
  });

  test('2. 切断状態は iframe 非表示・開始ボタン表示', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await stubStatus(page, DOWN);
    await authedGoto(page, '/terminal-view');

    await expect(page.getByRole('button', { name: 'ターミナルを開始' })).toBeVisible();
    await expect(page.getByText('ターミナルが切断されています')).toBeVisible();
    // 切断中は iframe を張らない。
    await expect(page.locator('iframe[title="Apollo ターミナル"]')).toHaveCount(0);
    // 画像添付ツールバーは引き続き存在（共存）。
    await expect(page.getByRole('button', { name: '画像を選択' })).toBeVisible();

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);
    await page.screenshot({ path: path.join(SHOT_DIR, '390-terminal-start-down.png') });
  });

  test('3. 開始ボタン押下 → start → ready 切替 → iframe 再表示', async ({ page }) => {
    // 最初は down、start 呼び出し後は ready を返すように status を切り替える。
    let started = false;
    await page.route('**/api/terminal/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(started ? READY : DOWN),
      });
    });
    let startCalls = 0;
    await page.route('**/api/terminal/start', async (route) => {
      startCalls += 1;
      started = true; // 以後の status は ready を返す
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, actions: ['created-tmux-session', 'started-ttyd'], status: READY }),
      });
    });

    await authedGoto(page, '/terminal-view');
    const startBtn = page.getByRole('button', { name: 'ターミナルを開始' });
    await expect(startBtn).toBeVisible();

    await startBtn.click();

    // start 後に ready になり iframe が出る。
    await expect(page.locator('iframe[title="Apollo ターミナル"]')).toHaveCount(1, { timeout: 8000 });
    await expect(page.getByRole('button', { name: 'ターミナルを開始' })).toHaveCount(0);
    expect(startCalls, 'start was called once').toBe(1);
  });

  test('4. start 失敗時はエラー文言を表示', async ({ page }) => {
    await stubStatus(page, DOWN);
    await page.route('**/api/terminal/start', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'tmux new-session failed (code 1): boom' }),
      });
    });

    await authedGoto(page, '/terminal-view');
    await page.getByRole('button', { name: 'ターミナルを開始' }).click();

    await expect(page.getByRole('alert')).toContainText(/tmux new-session failed/);
    // 失敗後も iframe は出さない。
    await expect(page.locator('iframe[title="Apollo ターミナル"]')).toHaveCount(0);
  });
});

test.describe('1280px デスクトップ回帰', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('5. デスクトップ: 稼働中は iframe 表示・切断中は開始ボタン', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // まず実サーバ status（ready）。
    await authedGoto(page, '/terminal-view');
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('iframe[title="Apollo ターミナル"]')).toHaveCount(1);

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);
    await page.screenshot({ path: path.join(SHOT_DIR, '1280-terminal-start.png'), fullPage: true });
  });
});
