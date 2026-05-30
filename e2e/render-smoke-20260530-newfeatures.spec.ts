// test-smoke: Apollo web 新機能の生死確認 2026-05-30
//   (1) Token 消費量ビュー (/usage)
//   (2) 受信箱 FAB（画像付き投入）
// viewport 390x844（モバイル主軸）+ 1280px（デスクトップ回帰）。
//
// 認証: ?token=<MC_TOKEN> 初回アクセス → httpOnly Cookie 発行 → クリーン URL に 302。
// 以後は同一 context の Cookie で通る。
//
// 浅く速くが原則。深い挙動検証は test-functional 領域。
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(REPO_ROOT, 'docs', 'render-screenshots', 'smoke');

// MC_TOKEN は .mc.env から読む（ログには出さない）。
const TOKEN = (() => {
  const raw = readFileSync(path.join(REPO_ROOT, '.mc.env'), 'utf8');
  const m = raw.match(/MC_TOKEN\s*=\s*(.+)/);
  if (!m) throw new Error('MC_TOKEN not found in .mc.env');
  return m[1].trim();
})();

// 1x1 透明 PNG。FAB の画像 input 用テスト素材。
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// 認証 Cookie を仕込んでクリーン URL へ遷移（SSE があるため domcontentloaded で待つ）。
async function authedGoto(page: Page, urlPath: string) {
  const url =
    urlPath === '/' ? `/?token=${TOKEN}` : `${urlPath}?token=${TOKEN}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

// body の横スクロール量（>1px は崩れ扱い）。
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth, document.body.scrollWidth) - el.clientWidth;
  });
}

test.describe('390px モバイル', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('1. /usage が描画され実 API 値・期間トグル・横スクロール無し', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await authedGoto(page, '/usage');

    // 大見出し（当日 / 全期間）と内訳セクション。
    await expect(page.getByRole('heading', { name: 'プロジェクト別' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'モデル別' })).toBeVisible();
    await expect(page.getByText('当日', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('全期間', { exact: true }).first()).toBeVisible();

    // 大見出しの数値が「---」「NaN」「空」でないこと（実 API が値を返している）。
    const bigStat = page.locator('.text-3xl.font-bold').first();
    await expect(bigStat).toBeVisible();
    const statText = (await bigStat.textContent())?.trim() ?? '';
    expect(statText.length, 'big stat not empty').toBeGreaterThan(0);
    expect(statText, 'big stat not dashes').not.toMatch(/^-+$/);
    expect(statText.toLowerCase(), 'big stat not NaN').not.toContain('nan');

    // 内訳カードが少なくとも 1 件レンダリング。
    const projectRows = page
      .locator('section')
      .filter({ hasText: 'プロジェクト別' })
      .locator('.rounded-lg.border');
    expect(await projectRows.count(), 'project breakdown rows').toBeGreaterThan(0);

    // 期間トグル（aria-pressed 切替）。
    const lastHourTab = page.getByRole('button', { name: '直近1h' });
    const allTab = page.getByRole('button', { name: '全期間' });
    await expect(lastHourTab).toBeVisible();
    await lastHourTab.click();
    await expect(lastHourTab).toHaveAttribute('aria-pressed', 'true');
    await allTab.click();
    await expect(allTab).toHaveAttribute('aria-pressed', 'true');

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);

    await page.screenshot({ path: path.join(SHOT_DIR, '390-usage.png'), fullPage: true });
  });

  test('2. ボトムナビ 7 項目が 390px で潰れず表示・遷移できる', async ({ page }) => {
    await authedGoto(page, '/');
    const nav = page.locator('nav[aria-label="主要ナビゲーション"]');
    await nav.waitFor({ state: 'visible' });

    const items = nav.locator('a');
    await expect(items).toHaveCount(7);

    // 追加された「消費」項目。
    await expect(nav.getByText('消費', { exact: true })).toBeVisible();

    // 各項目が潰れていない（幅 > 20px / 高さ >= 44px）。
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const box = await items.nth(i).boundingBox();
      expect(box, `nav item ${i} box`).toBeTruthy();
      expect(box!.width, `nav item ${i} width`).toBeGreaterThan(20);
      expect(box!.height, `nav item ${i} height`).toBeGreaterThanOrEqual(44);
    }

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // 消費タブで遷移。
    await nav.getByText('消費', { exact: true }).click();
    await expect(page).toHaveURL(/\/usage$/);
    await expect(page.getByRole('heading', { name: 'プロジェクト別' })).toBeVisible();

    await page.screenshot({ path: path.join(SHOT_DIR, '390-bottomnav.png'), fullPage: true });
  });

  test('3. FAB が表示され、フォーム（kind/project/text/画像input）が開き text 必須が効く', async ({ page }) => {
    await authedGoto(page, '/');

    const fab = page.getByRole('button', { name: '受信箱に追加' });
    await expect(fab).toBeVisible();
    await fab.click();

    const dialog = page.getByRole('dialog', { name: '受信箱に追加' });
    await expect(dialog).toBeVisible();

    // kind トグル / project セレクト / text。
    await expect(dialog.getByRole('button', { name: 'タスク' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '指示' })).toBeVisible();
    await expect(dialog.locator('#inbox-project')).toBeVisible();
    await expect(dialog.locator('#inbox-text')).toBeVisible();

    // 画像 file input（accept に image を含む）。
    const fileInput = dialog.locator('input[type="file"][accept*="image"]');
    await expect(fileInput).toHaveCount(1);

    // text 必須: 空のとき送信 disabled。
    const submit = dialog.getByRole('button', { name: '追加する' });
    await expect(submit).toBeDisabled();

    // text 入力で enable。
    await dialog.locator('#inbox-text').fill('スモークテスト用ダミー');
    await expect(submit).toBeEnabled();

    // 画像 1 枚選択でクラッシュしない（プレビュー削除ボタン出現）。
    await fileInput.setInputFiles({ name: 'smoke.png', mimeType: 'image/png', buffer: PNG_1x1 });
    await expect(dialog.getByRole('button', { name: /smoke\.png を削除/ })).toBeVisible();

    await page.screenshot({ path: path.join(SHOT_DIR, '390-fab-form.png') });
  });

  test('4. text のみで実 POST → 201 → GET /api/inbox pending に出る → consumed で後始末', async ({ page, request }) => {
    await authedGoto(page, '/');

    const marker = `__SMOKE_20260530_${Date.now()}__`;

    await page.getByRole('button', { name: '受信箱に追加' }).click();
    const dialog = page.getByRole('dialog', { name: '受信箱に追加' });
    await dialog.locator('#inbox-text').fill(marker);

    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/inbox') && r.request().method() === 'POST',
      ),
      dialog.getByRole('button', { name: '追加する' }).click(),
    ]);
    expect(resp.status(), 'POST /api/inbox status').toBe(201);
    const created = (await resp.json()) as { id: string; status: string };
    expect(created.id, 'created id').toBeTruthy();
    expect(created.status).toBe('pending');

    // 成功トースト。
    await expect(
      page.getByRole('status').filter({ hasText: 'タスクを追加しました' }),
    ).toBeVisible();

    // GET /api/inbox の pending に含まれる。
    const listRes = await request.get('/api/inbox', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(listRes.status()).toBe(200);
    const list = (await listRes.json()) as { pending: { id: string; text: string }[] };
    const found = list.pending.find((e) => e.id === created.id);
    expect(found, 'created entry present in pending').toBeTruthy();
    expect(found!.text).toBe(marker);

    // 後始末: consumed.jsonl に id を追記してデータ汚染を防ぐ。
    appendFileSync(path.join(REPO_ROOT, 'data', 'inbox-consumed.jsonl'), created.id + '\n', 'utf-8');

    // 掃除後は pending から消える。
    const after = await request.get('/api/inbox', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const afterList = (await after.json()) as { pending: { id: string }[] };
    expect(
      afterList.pending.find((e) => e.id === created.id),
      'consumed entry gone',
    ).toBeFalsy();
  });
});

test.describe('1280px デスクトップ回帰', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('5. サイドバー表示・ボトムナビ非表示・/usage 従来表示が壊れていない', async ({ page }) => {
    await authedGoto(page, '/');

    const sidebar = page.locator('aside');
    await sidebar.waitFor({ state: 'visible' });
    await expect(sidebar.getByText('Apollo', { exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: '消費量' })).toBeVisible();

    // ボトムナビは md+ で非表示。
    await expect(page.locator('nav[aria-label="主要ナビゲーション"]')).toBeHidden();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(SHOT_DIR, '1280-overview.png'), fullPage: true });

    // /usage デスクトップ表示。
    await page.getByRole('link', { name: '消費量' }).click();
    await expect(page).toHaveURL(/\/usage$/);
    await expect(page.getByRole('heading', { name: 'プロジェクト別' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'モデル別' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(SHOT_DIR, '1280-usage.png'), fullPage: true });

    // FAB はデスクトップでも常設。
    await expect(page.getByRole('button', { name: '受信箱に追加' })).toBeVisible();
  });
});
