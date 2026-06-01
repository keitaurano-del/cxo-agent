// test-smoke: Apollo ターミナル画像添付ステージング（MC-95 / MC-102 拡張）生死確認 2026-06-01
//   (1) ターミナルビューに「画像を選択」ボタンと Ctrl+V ヒントが表示される
//   (2) ファイル複数選択 → サムネが複数表示される（即送信されない）
//   (3) Ctrl+V 画像貼付 → ステージングに追加される（プレビュー枚数が増える）
//   (4) 個別削除 × でサムネが消える
//   (5) 5 枚超過が抑止される（合計 5 枚上限・エラー文言）
//   (6) 「林に送る」→ /api/terminal/upload に複数枚 multipart が 1 回飛び 201、
//        成功フィードバックが出て、ステージングがクリアされる
//   (7) 390px 横スクロール無し / 1280px 回帰
//
// 注意: 実 tmux main を壊さないため、/api/terminal/upload は page.route で
//   インターセプトして canned 201（injected:true）を返す。これで staging → 「林に送る」→
//   fetch → 成功表示 までのフロント経路を、実サーバの tmux send-keys に触れず検証する。
//   サーバ側（保存・tmux 注入・複数枚対応・バリデーション・認証ゲート）は curl で別途検証済み。
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

const PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_BIN = Buffer.from(PNG_1x1_B64, 'base64');

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

// /api/terminal/upload を canned 201 にすげ替える（実 tmux を触らない）。
// 呼ばれた回数と、最後に受け取った images フィールド数を観測する。
async function stubUpload(page: Page): Promise<{ calls: () => number; lastCount: () => number }> {
  let calls = 0;
  let lastCount = 0;
  await page.route('**/api/terminal/upload', async (route) => {
    calls += 1;
    // multipart の images フィールド数を数える（boundary 区切りの "name=\"images\"" 出現回数）。
    const post = route.request().postData() ?? '';
    lastCount = (post.match(/name="images"/g) ?? []).length;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        count: lastCount || 1,
        paths: Array.from({ length: lastCount || 1 }, (_, i) => `/home/dev/.../stub-${i}.png`),
        injected: true,
        target: 'main',
      }),
    });
  });
  return { calls: () => calls, lastCount: () => lastCount };
}

// N 枚を一気に setInputFiles で選択する。
async function pickFiles(page: Page, n: number, prefix = 'pick') {
  await page.locator('#terminal-images').setInputFiles(
    Array.from({ length: n }, (_, i) => ({
      name: `${prefix}-${i}.png`,
      mimeType: 'image/png',
      buffer: PNG_BIN,
    })),
  );
}

async function dispatchImagePaste(page: Page, b64: string, fileName: string) {
  await page.evaluate(
    ({ b64, fileName }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], fileName, { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      if (!ev.clipboardData || ev.clipboardData.items.length === 0) {
        Object.defineProperty(ev, 'clipboardData', { value: dt });
      }
      window.dispatchEvent(ev);
    },
    { b64, fileName },
  );
}

// ステージング中のサムネ画像数（object:URL の img を数える）。
function thumbCount(page: Page) {
  return page.locator('img[src^="blob:"]').count();
}

test.describe('390px モバイル', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('1. ターミナルビューに画像添付ツールバーが表示される', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/terminal-view');

    await expect(page.getByRole('button', { name: '画像を選択' })).toBeVisible();
    await expect(page.getByText(/Ctrl\+V/).first()).toBeVisible();
    await expect(page.locator('iframe[title="Apollo ターミナル"]')).toHaveCount(1);

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);
    await page.screenshot({ path: path.join(SHOT_DIR, '390-terminal-upload.png') });
  });

  test('2. ファイル複数選択 → サムネが複数表示される（即送信されない）', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const stub = await stubUpload(page);

    await authedGoto(page, '/terminal-view');
    await expect(page.getByRole('button', { name: '画像を選択' })).toBeVisible();

    await pickFiles(page, 3, 'multi');

    // サムネが 3 枚出る。送信ボタンが「林に送る（3 枚）」になる。即送信はされない。
    await expect.poll(() => thumbCount(page)).toBe(3);
    await expect(page.getByRole('button', { name: /林に送る（3 枚）/ })).toBeVisible();
    expect(stub.calls(), 'no auto-upload on staging').toBe(0);

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);
    await page.screenshot({ path: path.join(SHOT_DIR, '390-terminal-staging.png') });
  });

  test('3. Ctrl+V 画像貼付 → プレビューに追加される', async ({ page }) => {
    await stubUpload(page);
    await authedGoto(page, '/terminal-view');
    await expect(page.getByRole('button', { name: '画像を選択' })).toBeVisible();

    await pickFiles(page, 1, 'base');
    await expect.poll(() => thumbCount(page)).toBe(1);

    await dispatchImagePaste(page, PNG_1x1_B64, 'pasted-terminal.png');
    await expect.poll(() => thumbCount(page)).toBe(2);
  });

  test('4. 個別削除 × でサムネが消える', async ({ page }) => {
    await stubUpload(page);
    await authedGoto(page, '/terminal-view');

    await pickFiles(page, 2, 'del');
    await expect.poll(() => thumbCount(page)).toBe(2);

    // 1 枚目の削除ボタンを押す。
    await page.getByRole('button', { name: /を削除$/ }).first().click();
    await expect.poll(() => thumbCount(page)).toBe(1);
  });

  test('5. 合計 5 枚上限が抑止される', async ({ page }) => {
    await stubUpload(page);
    await authedGoto(page, '/terminal-view');

    // 一気に 7 枚選択 → 5 枚だけステージング、超過はエラー表示。
    await pickFiles(page, 7, 'cap');
    await expect.poll(() => thumbCount(page)).toBe(5);
    await expect(page.getByRole('alert')).toContainText(/合計 5 枚まで/);
    await expect(page.getByText(/5 \/ 5 枚/)).toBeVisible();
  });

  test('6. 林に送る → 複数枚 multipart 一括送信 → 201 → ステージングクリア', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const stub = await stubUpload(page);

    await authedGoto(page, '/terminal-view');
    await pickFiles(page, 3, 'send');
    await expect.poll(() => thumbCount(page)).toBe(3);

    await page.getByRole('button', { name: /林に送る（3 枚）/ }).click();

    // 成功 status（注入済み文言、3 枚）が出る。
    await expect(page.getByRole('status')).toContainText(/3 枚を林の入力欄に追加しました/);
    // upload は 1 回だけ呼ばれ、images フィールドが 3 個入っている（一括送信）。
    expect(stub.calls(), 'single batched upload').toBe(1);
    expect(stub.lastCount(), '3 images in one multipart request').toBe(3);
    // ステージングはクリアされ、サムネが消える。
    await expect.poll(() => thumbCount(page)).toBe(0);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);
  });
});

test.describe('1280px デスクトップ回帰', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('7. デスクトップでターミナルビューが壊れていない', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/terminal-view');
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.getByRole('button', { name: '画像を選択' })).toBeVisible();
    await expect(page.locator('iframe[title="Apollo ターミナル"]')).toHaveCount(1);

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);
    await page.screenshot({ path: path.join(SHOT_DIR, '1280-terminal-upload.png'), fullPage: true });
  });
});
