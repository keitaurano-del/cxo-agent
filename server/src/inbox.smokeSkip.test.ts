// isSmokeText 単体テスト（MC-99）
//
// vitest 等のテストランナーは未導入のため、node:assert + tsx で実行する最小テスト。
//   実行: node node_modules/.bin/tsx src/inbox.smokeSkip.test.ts （server/ 配下で）
//
// 主眼: SMOKE マーカー検出が
//   (a) 実際の投入形（__SMOKE_<日付>_<epoch>__、プレフィックス無し）にマッチする
//   (b) プレフィックス付き（例「【Apollo投入】 __SMOKE_...__」）でもマッチする
//   (c) 通常の task/instruction text にはマッチしない（非退行）
// を決定的に検証する。

import assert from 'node:assert/strict';

import { isSmokeText } from './inbox.js';

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`  FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── (a) 実投入形（プレフィックス無し） ─────────────────────────
check('プレフィックス無し __SMOKE_<日付>_<epoch>__ にマッチ', () => {
  assert.equal(isSmokeText('__SMOKE_20260530_1780151972114__'), true);
  assert.equal(isSmokeText('__SMOKE_20260601_1780295321203__'), true);
});

// ── (b) プレフィックス付き ─────────────────────────────────────
check('プレフィックス付き「【Apollo投入】 __SMOKE_...__」にマッチ', () => {
  assert.equal(isSmokeText('【Apollo投入】 __SMOKE_20260601_1780295321203__'), true);
  assert.equal(isSmokeText('health __SMOKE_20260530_123__ check'), true);
});

// ── (c) 通常 text は非マッチ（非退行） ─────────────────────────
check('通常タスク text はマッチしない', () => {
  assert.equal(isSmokeText('ログイン画面のバグを直す'), false);
  assert.equal(isSmokeText('Fix the checkout flow timeout'), false);
  // SMOKE という語が含まれても token 形式でなければ非マッチ。
  assert.equal(isSmokeText('スモークテストの結果を共有する SMOKE test results'), false);
  // 単独の __SMOKE（閉じ __ が無い・token 未完成）は起票対象として扱う＝非マッチ。
  assert.equal(isSmokeText('__SMOKE だけで token 未完成'), false);
});

console.log(`\nisSmokeText: ${3 - failures}/3 passed`);
if (failures > 0) {
  process.exit(1);
}
