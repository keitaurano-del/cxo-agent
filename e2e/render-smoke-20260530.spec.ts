// test-smoke: Apollo スマホ(390px)レスポンシブ生死確認。
// 6 画面を iPhone 相当 viewport で開き、横スクロール無し / ボトムタブバー表示 /
// サイドバー非表示 / 致命的クラッシュ無し を判定する。
import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = (() => {
  const envPath = path.resolve(__dirname, '../.mc.env');
  const raw = fs.readFileSync(envPath, 'utf8');
  const m = raw.match(/MC_TOKEN\s*=\s*(.+)/);
  if (!m) throw new Error('MC_TOKEN not found in .mc.env');
  return m[1].trim();
})();

const SHOT_DIR = path.resolve(__dirname, '../docs/render-screenshots/smoke');

// 正準ナビ契約（MC-98 で 7→5 ドリフトに追従）。
// トップレベルナビ（サイドバー / ボトムナビ共通）は web/src/App.tsx の NAV 配列が単一の正本。
// 数値ハードコードを避けるため shortLabel 配列の長さを期待値に使う。
// ボトムナビは shortLabel、サイドバーは label を表示する。
const TOP_NAV = [
  { to: '/', shortLabel: 'ダッシュ', label: 'ダッシュボード' },
  { to: '/tasks', shortLabel: 'ボード', label: 'タスクボード' },
  { to: '/approvals', shortLabel: '承認', label: '承認フロー' },
  { to: '/vault', shortLabel: 'Vault', label: 'Vault' },
  { to: '/terminal-view', shortLabel: '端末', label: 'ターミナル' },
];
const EXPECTED_TAB_COUNT = TOP_NAV.length;

const SCREENS = [
  { name: 'overview', urlPath: '/', label: '司令塔' },
  { name: 'agents', urlPath: '/agents', label: 'エージェント' },
  { name: 'feed', urlPath: '/feed', label: '会話' },
  { name: 'tasks', urlPath: '/tasks', label: 'タスクボード' },
  { name: 'today', urlPath: '/today', label: '今日' },
  { name: 'vault', urlPath: '/vault', label: 'Vault' },
];

const MOBILE = { width: 390, height: 844 };

// 390px モバイル: 各画面ごとに 1 テスト
for (const screen of SCREENS) {
  test(`mobile 390px: ${screen.name} (${screen.label})`, async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['iPhone 12'],
      viewport: MOBILE,
    });
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 初回は ?token で認証 → 302 でクリーン URL に飛び Cookie 発行
    const firstUrl =
      screen.urlPath === '/'
        ? `/?token=${TOKEN}`
        : `${screen.urlPath}?token=${TOKEN}`;
    // SSE(EventSource) が常時接続されるため networkidle は使わず domcontentloaded で待つ
    const resp = await page.goto(firstUrl, { waitUntil: 'domcontentloaded' });

    // 認証通過後のドキュメントが 200 で返ること
    expect(resp, `${screen.name}: no response`).toBeTruthy();
    expect(resp!.status(), `${screen.name}: final status`).toBeLessThan(400);

    // 描画安定待ち: ボトムナビ描画で React マウント完了を確認
    await page.locator('nav[aria-label="主要ナビゲーション"]').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);

    // 致命的クラッシュ無し: body にコンテンツがある（真っ白でない）
    const bodyText = (await page.locator('body').innerText()).trim();
    expect(bodyText.length, `${screen.name}: blank screen`).toBeGreaterThan(0);

    // 横スクロール検査
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      const body = document.body;
      const sw = Math.max(el.scrollWidth, body.scrollWidth);
      const cw = el.clientWidth;
      // 横にはみ出している要素を特定
      const culprits: string[] = [];
      const all = Array.from(document.querySelectorAll('*'));
      for (const node of all) {
        const r = (node as HTMLElement).getBoundingClientRect();
        if (r.right > cw + 1) {
          const tag = node.tagName.toLowerCase();
          const cls = (node as HTMLElement).className?.toString().slice(0, 60) || '';
          culprits.push(`${tag}.${cls} right=${Math.round(r.right)}`);
          if (culprits.length >= 5) break;
        }
      }
      return { scrollWidth: sw, clientWidth: cw, overflowPx: sw - cw, culprits };
    });

    // ボトムタブバー表示 / サイドバー非表示
    const bottomNav = page.locator('nav[aria-label="主要ナビゲーション"]');
    const bottomVisible = await bottomNav.isVisible();
    const sidebar = page.locator('aside');
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    // タブ数とタッチ標的サイズ
    const tabs = bottomNav.locator('a');
    const tabCount = await tabs.count();
    let minTabHeight = Infinity;
    for (let i = 0; i < tabCount; i++) {
      const box = await tabs.nth(i).boundingBox();
      if (box) minTabHeight = Math.min(minTabHeight, box.height);
    }

    // 本文の最小フォントサイズ（主要テキストが潰れていないか）
    const minFont = await page.evaluate(() => {
      const txt = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, li, a'))
        .filter((n) => (n.textContent || '').trim().length > 3)
        .map((n) => parseFloat(getComputedStyle(n).fontSize))
        .filter((v) => !Number.isNaN(v));
      return txt.length ? Math.min(...txt) : 0;
    });

    await page.screenshot({
      path: path.join(SHOT_DIR, `mobile-${screen.name}.png`),
      fullPage: false,
    });

    // 診断ログ
    console.log(
      `[${screen.name}] status=${resp!.status()} overflowPx=${overflow.overflowPx} ` +
        `bottomNav=${bottomVisible} sidebar=${sidebarVisible} tabs=${tabCount} ` +
        `minTabH=${minTabHeight === Infinity ? 'n/a' : Math.round(minTabHeight)} minFont=${minFont} ` +
        `consoleErr=${consoleErrors.length} pageErr=${pageErrors.length}`,
    );
    if (overflow.culprits.length) {
      console.log(`[${screen.name}] overflow culprits: ${overflow.culprits.join(' | ')}`);
    }
    if (pageErrors.length) console.log(`[${screen.name}] pageErrors: ${pageErrors.join(' || ')}`);

    // ----- assertions -----
    expect(pageErrors, `${screen.name}: uncaught page errors`).toHaveLength(0);
    expect(overflow.overflowPx, `${screen.name}: horizontal overflow`).toBeLessThanOrEqual(1);
    expect(bottomVisible, `${screen.name}: bottom tab bar visible`).toBe(true);
    expect(sidebarVisible, `${screen.name}: sidebar hidden on mobile`).toBe(false);
    expect(tabCount, `${screen.name}: ${EXPECTED_TAB_COUNT} bottom tabs`).toBe(EXPECTED_TAB_COUNT);
    expect(minTabHeight, `${screen.name}: tab touch target >= 44px`).toBeGreaterThanOrEqual(44);
    expect(minFont, `${screen.name}: min font >= 10px`).toBeGreaterThanOrEqual(10);

    await context.close();
  });
}

// ボトムタブのタップで画面遷移できること
test('mobile 390px: bottom tab navigation works', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 12'], viewport: MOBILE });
  const page = await context.newPage();
  await page.goto(`/?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });

  const bottomNav = page.locator('nav[aria-label="主要ナビゲーション"]');
  await bottomNav.waitFor({ state: 'visible' });

  // ボトムナビに実在するトップレベル項目で遷移を確認する（MC-98: 会話/feed は
  // ダッシュボードのサブタブに移動したためボトムナビには無い）。
  await bottomNav.locator('a', { hasText: 'Vault' }).click();
  await expect(page).toHaveURL(/\/vault/);

  await bottomNav.locator('a', { hasText: 'ボード' }).click();
  await expect(page).toHaveURL(/\/tasks/);

  // ダッシュボードに戻れること（端末ルートは /terminal-view、proxy の /terminal とは別）。
  await bottomNav.locator('a', { hasText: '端末' }).click();
  await expect(page).toHaveURL(/\/terminal-view/);

  await context.close();
});

// デスクトップ 1280px: 従来表示（サイドバー表示 / ボトムバー非表示）が壊れていないか 1 枚
test('desktop 1280px: sidebar layout intact', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.locator('aside').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);

  const sidebar = page.locator('aside');
  const bottomNav = page.locator('nav[aria-label="主要ナビゲーション"]');
  const sidebarVisible = await sidebar.isVisible();
  const bottomVisible = await bottomNav.isVisible();

  const overflowPx = await page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth, document.body.scrollWidth) - el.clientWidth;
  });

  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-overview.png'), fullPage: false });
  console.log(
    `[desktop] sidebar=${sidebarVisible} bottomNav=${bottomVisible} overflowPx=${overflowPx}`,
  );

  expect(sidebarVisible, 'desktop: sidebar visible').toBe(true);
  expect(bottomVisible, 'desktop: bottom nav hidden').toBe(false);
  expect(overflowPx, 'desktop: no horizontal overflow').toBeLessThanOrEqual(1);

  await context.close();
});
