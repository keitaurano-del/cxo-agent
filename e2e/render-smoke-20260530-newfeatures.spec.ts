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
import { readFileSync } from 'node:fs';
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

// 正準ナビ契約（MC-98 で 7→5 ドリフトに追従）。
// トップレベルのボトムナビ短ラベルは web/src/App.tsx の NAV 配列が単一の正本。
// 消費量(/usage) はボトムナビから外れ、ダッシュボードのタブ帯に移動した。
const BOTTOM_NAV_SHORT_LABELS = ['ダッシュ', 'ボード', '承認', 'Vault', '端末'];

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
    // 注: BigStat（当日/全期間）が「…の消費量内訳を開く」ボタンになり名前部分一致で衝突するため、
    //     トグルは exact 一致で取得する（MC-67 全タイル展開）。
    const lastHourTab = page.getByRole('button', { name: '直近1h', exact: true });
    const allTab = page.getByRole('button', { name: '全期間', exact: true });
    await expect(lastHourTab).toBeVisible();
    await lastHourTab.click();
    await expect(lastHourTab).toHaveAttribute('aria-pressed', 'true');
    await allTab.click();
    await expect(allTab).toHaveAttribute('aria-pressed', 'true');

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1);
    expect(pageErrors, 'no uncaught page errors').toHaveLength(0);

    await page.screenshot({ path: path.join(SHOT_DIR, '390-usage.png'), fullPage: true });
  });

  test(`2. ボトムナビ ${BOTTOM_NAV_SHORT_LABELS.length} 項目が 390px で潰れず表示・遷移でき、消費量はダッシュタブから開ける`, async ({ page }) => {
    await authedGoto(page, '/');
    const nav = page.locator('nav[aria-label="主要ナビゲーション"]');
    await nav.waitFor({ state: 'visible' });

    // MC-98: ボトムナビは 5 トップレベル項目に集約（旧 7 項目から変更）。
    // 消費量(/usage) はボトムナビから外れ、ダッシュボードのタブ帯に移動した。
    const items = nav.locator('a');
    await expect(items).toHaveCount(BOTTOM_NAV_SHORT_LABELS.length);
    for (const label of BOTTOM_NAV_SHORT_LABELS) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
    }

    // 各項目が潰れていない（幅 > 20px / 高さ >= 44px）。
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const box = await items.nth(i).boundingBox();
      expect(box, `nav item ${i} box`).toBeTruthy();
      expect(box!.width, `nav item ${i} width`).toBeGreaterThan(20);
      expect(box!.height, `nav item ${i} height`).toBeGreaterThanOrEqual(44);
    }

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // 消費量はダッシュボードのタブ帯（俯瞰/今日/会話/エージェント/ティック/消費量）から開く。
    const dashTabs = page.locator('nav[aria-label="ダッシュボードのタブ"]');
    await dashTabs.getByRole('tab', { name: '消費量' }).click();
    await expect(page).toHaveURL(/\/usage$/);
    await expect(page.getByRole('heading', { name: 'プロジェクト別' })).toBeVisible();

    await page.screenshot({ path: path.join(SHOT_DIR, '390-bottomnav.png'), fullPage: true });
  });

  test('3. FAB が表示され、フォーム（project/agent/priority/text/画像input）が開き text 必須が効く', async ({ page }) => {
    await authedGoto(page, '/');

    const fab = page.getByRole('button', { name: '受信箱に追加' });
    await expect(fab).toBeVisible();
    await fab.click();

    const dialog = page.getByRole('dialog', { name: '受信箱に追加' });
    await expect(dialog).toBeVisible();

    // MC-77: タスク/指示の kind トグルは廃止（投入は全て「タスク」として送る）。
    // 現状のフォームは project / 担当エージェント / 優先度 / text セレクト群。
    await expect(dialog.getByRole('button', { name: 'タスク' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '指示' })).toHaveCount(0);
    await expect(dialog.locator('#inbox-project')).toBeVisible();
    await expect(dialog.locator('#inbox-agent')).toBeVisible();
    await expect(dialog.locator('#inbox-priority')).toBeVisible();
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

  // MC-99: SMOKE マーカーはサーバ側で「起票せず即 consumed」になった（台帳の幽霊カード化を防止）。
  // よって 201 で投入できるが pending には出ず、TASK_TRACKER にも幽霊カードが作られない。
  test('4. SMOKE text を実 POST → 201 → 起票されず（taskId 無し）→ pending に出ない（MC-99）', async ({ page, request }) => {
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
    const created = (await resp.json()) as { id: string; status: string; taskId?: string };
    expect(created.id, 'created id').toBeTruthy();
    expect(created.status).toBe('pending');
    // MC-99: SMOKE は起票しない＝台帳の幽霊カードを作らない。
    expect(created.taskId, 'SMOKE は taskId を持たない（起票スキップ）').toBeUndefined();

    // 成功トースト。
    await expect(
      page.getByRole('status').filter({ hasText: 'タスクを追加しました' }),
    ).toBeVisible();

    // MC-99: サーバが SMOKE skip として consumed 済みにするため、pending には出ない。
    const listRes = await request.get('/api/inbox', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(listRes.status()).toBe(200);
    const list = (await listRes.json()) as { pending: { id: string; text: string }[] };
    expect(
      list.pending.find((e) => e.id === created.id),
      'SMOKE entry auto-consumed (not in pending)',
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
    // MC-98: サイドバーはトップレベル 5 項目。消費量はサイドバーから外れ、
    // ダッシュボードのタブ帯に移動したので、サイドバーには「ダッシュボード」リンクが在ることを確認する。
    await expect(sidebar.getByRole('link', { name: 'ダッシュボード' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'ターミナル' })).toBeVisible();

    // ボトムナビは md+ で非表示。
    await expect(page.locator('nav[aria-label="主要ナビゲーション"]')).toBeHidden();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(SHOT_DIR, '1280-overview.png'), fullPage: true });

    // /usage デスクトップ表示はダッシュボードのタブ帯から開く（消費量はサブタブに移動）。
    await page
      .locator('nav[aria-label="ダッシュボードのタブ"]')
      .getByRole('tab', { name: '消費量' })
      .click();
    await expect(page).toHaveURL(/\/usage$/);
    await expect(page.getByRole('heading', { name: 'プロジェクト別' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'モデル別' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(SHOT_DIR, '1280-usage.png'), fullPage: true });

    // FAB はデスクトップでも常設。
    await expect(page.getByRole('button', { name: '受信箱に追加' })).toBeVisible();
  });
});
