// test-smoke: Apollo web 新 UI 生死確認 2026-05-30
//   (1) 受信箱 FAB フォームの Ctrl+V 画像貼付（DataTransfer で paste イベント dispatch）
//   (2) Vault ビューの「追加」操作 → ノート作成 / ファイル input を持つフォームが開く
//   (3) 390px 横スクロール無し・崩れ無し / 1280px 従来表示が壊れていない
// viewport 390x844（モバイル主軸）+ 1280px（デスクトップ回帰）。
//
// 認証: ?token=<MC_TOKEN> 初回アクセス → httpOnly Cookie 発行 → クリーン URL に 302。
// 注意: Vault への実 POST はしない（obsidian-vault に実コミットされ得るため）。
//   UI 表示・file input 存在・paste ハンドラ動作（プレビュー増加）まで。
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

// 1x1 透明 PNG（base64）。clipboard 画像のダミー素材。
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

// window レベルの paste ハンドラへ、画像入り DataTransfer を載せた ClipboardEvent を dispatch。
// 実クリップボードに依存せず paste ハンドラの動作（addFiles → プレビュー増加）を検証する。
async function dispatchImagePaste(page: Page, b64: string, fileName: string) {
  await page.evaluate(
    ({ b64, fileName }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], fileName, { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      // 一部ブラウザは ClipboardEvent.clipboardData が read-only なので保険で再定義。
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

  test('1. 受信箱 FAB フォームで Ctrl+V 画像貼付 → プレビューが1枚増える', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/');

    const fab = page.getByRole('button', { name: '受信箱に追加' });
    await expect(fab).toBeVisible();
    await fab.click();

    const dialog = page.getByRole('dialog', { name: '受信箱に追加' });
    await expect(dialog).toBeVisible();

    // ヒント文が表示されている（paste 受付の明示）。
    await expect(dialog.getByText(/Ctrl\+V.*画像を貼り付け/)).toBeVisible();

    // 貼付前: 0/5。
    await expect(dialog.getByText('0/5', { exact: true })).toBeVisible();

    // paste イベントを window に dispatch → addFiles でプレビュー 1 枚増加。
    await dispatchImagePaste(page, PNG_1x1_B64, 'pasted-smoke.png');

    // カウンタが 1/5 になる + プレビュー img が 1 枚。
    await expect(dialog.getByText('1/5', { exact: true })).toBeVisible();
    const previews = dialog.locator('img[alt="pasted-smoke.png"]');
    await expect(previews).toHaveCount(1);
    // 削除ボタンも出る（プレビューが描画された証拠）。
    await expect(
      dialog.getByRole('button', { name: /pasted-smoke\.png を削除/ }),
    ).toBeVisible();

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);

    await page.screenshot({ path: path.join(SHOT_DIR, '390-fab-paste.png') });
  });

  test('2. Vault の「追加」でフォームが開く（ノート作成 title+body / ファイル input）', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/vault');

    // 追加操作（PageHeader 右の「追加」ボタン）。
    const addBtn = page.getByRole('button', { name: '追加', exact: true });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const dialog = page.getByRole('dialog', { name: 'Vault に追加' });
    await expect(dialog).toBeVisible();

    // タブ: ノート作成 / ファイル。
    const noteTab = dialog.getByRole('button', { name: 'ノート作成' });
    const fileTab = dialog.getByRole('button', { name: 'ファイル' });
    await expect(noteTab).toBeVisible();
    await expect(fileTab).toBeVisible();

    // 既定はノート作成タブ: title + body + 保存先フォルダ。
    await expect(dialog.locator('#vault-note-title')).toBeVisible();
    await expect(dialog.locator('#vault-note-body')).toBeVisible();
    await expect(dialog.locator('#vault-note-folder')).toBeVisible();

    // ファイルタブへ: input[type=file] が存在する。
    await fileTab.click();
    const fileInput = dialog.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);
    // 「ファイルを選択」ボタンと Ctrl+V ヒント。
    await expect(dialog.getByRole('button', { name: /ファイルを選択/ })).toBeVisible();
    await expect(dialog.getByText(/Ctrl\+V.*画像を貼り付け/)).toBeVisible();

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);

    await page.screenshot({ path: path.join(SHOT_DIR, '390-vault-add.png') });
  });
});

test.describe('1280px デスクトップ回帰', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('3. デスクトップで Vault 追加フォーム / FAB が壊れていない', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/vault');

    // サイドバーが従来通り表示（回帰確認）。
    const sidebar = page.locator('aside');
    await sidebar.waitFor({ state: 'visible' });

    // Vault 追加が 1280 でも開ける。
    const addBtn = page.getByRole('button', { name: '追加', exact: true });
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    const dialog = page.getByRole('dialog', { name: 'Vault に追加' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'ファイル' }).click();
    await expect(dialog.locator('input[type="file"]')).toHaveCount(1);
    // ヘッダ X（dialog 直下の見出し横）で閉じる。背景オーバーレイの「閉じる」は避ける。
    await dialog.locator('h2:has-text("Vault に追加") + button[aria-label="閉じる"]').click();
    await expect(dialog).toBeHidden();

    // FAB はデスクトップでも常設。
    await expect(page.getByRole('button', { name: '受信箱に追加' })).toBeVisible();

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);

    await page.screenshot({ path: path.join(SHOT_DIR, '1280-vault-add.png'), fullPage: true });
  });
});
