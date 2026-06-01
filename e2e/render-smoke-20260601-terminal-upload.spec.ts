// test-smoke: Apollo ターミナル画像添付（MC-95）生死確認 2026-06-01
//   (1) ターミナルビューに「画像を選択」ボタンと Ctrl+V ヒントが表示される
//   (2) Ctrl+V 画像貼付 → POST /api/terminal/upload が呼ばれ、成功フィードバックが出る
//   (3) ファイル選択（setInputFiles）でも同経路で upload が呼ばれる
//   (4) 390px 横スクロール無し / 1280px 回帰
//
// 注意: 実 tmux main を壊さないため、/api/terminal/upload は page.route で
//   インターセプトして canned 201（injected:true）を返す。これで paste/file-select →
//   fetch → 成功表示 までのフロント経路を、実サーバの tmux send-keys に触れず検証する。
//   サーバ側（保存・tmux 注入・バリデーション・認証ゲート）は curl で別途検証済み。
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
// upload 呼び出しが起きたかを観測するため、呼ばれた回数も返す。
async function stubUpload(page: Page): Promise<{ calls: () => number }> {
  let calls = 0;
  await page.route('**/api/terminal/upload', async (route) => {
    calls += 1;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        paths: ['/home/dev/projects/cxo-agent/data/terminal-uploads/stub.png'],
        injected: true,
        target: 'main',
      }),
    });
  });
  return { calls: () => calls };
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

test.describe('390px モバイル', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('1. ターミナルビューに画像添付ツールバーが表示される', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/terminal-view');

    await expect(page.getByRole('button', { name: '画像を選択' })).toBeVisible();
    // Ctrl+V 貼付ヒント（ツールバー内）。同様の文言が説明段落にもあるので first を取る。
    await expect(page.getByText(/Ctrl\+V/).first()).toBeVisible();
    // iframe（ttyd）が埋め込まれている。
    await expect(page.locator('iframe[title="Apollo ターミナル"]')).toHaveCount(1);

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);
    await page.screenshot({ path: path.join(SHOT_DIR, '390-terminal-upload.png') });
  });

  test('2. Ctrl+V 画像貼付 → upload 呼び出し → 成功フィードバック', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const stub = await stubUpload(page);

    await authedGoto(page, '/terminal-view');
    await expect(page.getByRole('button', { name: '画像を選択' })).toBeVisible();

    await dispatchImagePaste(page, PNG_1x1_B64, 'pasted-terminal.png');

    // 成功 status（注入済み文言）が出る。
    await expect(page.getByRole('status')).toContainText(/林の入力欄に追加しました/);
    expect(stub.calls(), 'upload was called once via paste').toBe(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);
  });

  test('3. ファイル選択 → upload 呼び出し', async ({ page }) => {
    const stub = await stubUpload(page);
    await authedGoto(page, '/terminal-view');

    const bin = Buffer.from(PNG_1x1_B64, 'base64');
    await page.locator('#terminal-images').setInputFiles({
      name: 'picked.png',
      mimeType: 'image/png',
      buffer: bin,
    });

    await expect(page.getByRole('status')).toContainText(/林の入力欄に追加しました/);
    expect(stub.calls(), 'upload was called once via file select').toBe(1);
  });
});

test.describe('1280px デスクトップ回帰', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('4. デスクトップでターミナルビューが壊れていない', async ({ page }) => {
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
