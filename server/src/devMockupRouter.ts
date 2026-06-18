// devMockupRouter — 開発ページの AI モックアップ REST API（auth ミドルウェア配下）。
//
//  POST   /api/dev/mockup/generate    : { prompt, baseHtml?, instruction? } → 202 { jobId }（非同期ジョブ）
//  GET    /api/dev/mockup/job/:jobId  : ポーリング用。
//      { status:'pending'|'generating'|'done'|'error', html?, partial?, plan?, mockupId?, error?, saved?:[{id,title}] }
//      partial は生成途中の部分 HTML（ストリーム中）。クライアントはこれを逐次表示してコードをライブに見せる。
//      plan は HTML を書き始める前の「作り方」メモ（設計説明）。HTML が来るまで “考え中” の表示に使う。
//      新規生成も修正も「1 つの動くインタラクティブな単一 HTML プロトタイプ」を生成し、完了時に自動保存する。
//      saved は後方互換のため単一画面でも [{id,title}] 1 件を入れる。
//  GET    /api/dev/mockups          : { mockups: [{id,title,prompt,createdAt,updatedAt}] }（html 除く軽量）
//  GET    /api/dev/mockups/:id       : { mockup: {…,html} }
//  POST   /api/dev/mockups           : { id?, title, html, prompt? } → upsert（保存結果を返す）
//  DELETE /api/dev/mockups/:id        : 論理削除 { ok:true }
//
// 生成は plannerEstimate.ts の流儀を踏襲して claude CLI を安全起動する:
//   execFile(NOTEBOOK_CLAUDE_BIN, ['--model', model, '-p', prompt], {timeout, maxBuffer, env})
//   NUL バイトはプロンプトから除去し、execFile 自体も try/catch で囲って落とさない。
// 保存先はすべて data/ 配下（.gitignore 済み）。

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';

import {
  NOTEBOOK_CLAUDE_BIN,
  NOTEBOOK_CLAUDE_MODEL,
  DEV_MOCKUP_FALLBACK_MODEL,
} from './config.js';
import {
  deleteMockup,
  getMockup,
  listMockups,
  upsertMockup,
} from './lib/devMockupStore.js';
import { withClaudeSlot } from './lib/notebookClaude.js';

// ─── claude CLI（HTML 生成）──────────────────────────────────

/** 生成 1 回あたりのタイムアウト（ミリ秒）。非同期ジョブ化済みでエッジ上限から外れたので、
 *  分量の多い複雑なモックアップにも余裕を持たせて 240s。
 *  タイムアウト時はリトライしない（重すぎ＝再試行しても無駄に 240s 待たせるだけ）ので、
 *  これが実質「諦めるまでの最大待ち時間」になる。 */
const GENERATE_TIMEOUT_MS = 240_000;

/** HTML は大きくなり得るため maxBuffer を広めに取る（8MB）。 */
const GENERATE_MAX_BUFFER = 8 * 1024 * 1024;

/** 生成 HTML の出力ルール（厳守させる共通指示）。 */
const HTML_RULES = [
  '出力は「完全な単一 HTML5 ドキュメント」だけにしてください。必ず <!DOCTYPE html> から始め、',
  '<html>...</html> で完結させます。',
  '自己完結させること: CSS は <style>、JS は <script> でインラインに含める。',
  'Tailwind 等の CDN は使ってもよいが、極力自己完結を優先する。',
  'UI 文言は日本語で構いません。レスポンシブにすること。',
  'コードの要所（レイアウト/デザイン/各操作の動きのまとまり）の先頭に、プログラミング未経験者でも',
  '何をしているか分かる短い日本語コメントを入れること（例: <!-- ボタンを押したら数字を増やす --> や',
  '/* 画面の配色・余白の設定 */）。コメントは要点だけ・専門用語を避け、入れすぎないこと。',
  '重要: ---HTML--- 以降は、マークダウンや ``` のコードフェンス・説明文を一切入れず、HTML 本文のみを出力すること。',
].join('\n');

/**
 * 「先に作り方（設計）を平易な日本語で書いてから HTML を書く」ための共通指示。
 * 出力は必ず「作り方メモ → ---HTML--- だけの行 → HTML 本文」の順。
 * サーバは ---HTML--- で分割し、メモを “考え中” のライブ表示に、本文を保存用 HTML に使う。
 */
const PLAN_MARKER = '---HTML---';
const PLAN_RULES = [
  `まず最初に、これから作る試作品の「作り方」を、プログラミング未経験の人にも分かる平易な日本語で 4〜8 行で説明してください。`,
  '次の観点を簡潔に（箇条書き中心・短く・専門用語は避ける）: どんな画面か / 置く主な部品（ボタン・入力欄・一覧など）/ 主要ボタンを押すと何が起きるか / 配色や雰囲気の方針。',
  `その「作り方」を書き終えたら、次の行に ${PLAN_MARKER} とだけ書いた行を 1 行入れ、その直後の行から、完成した単一 HTML ドキュメント本文だけを出力してください。`,
].join('\n');

/** インタラクティブな「動く試作品」を作らせるための共通指示。新規生成・修正の両方で結合する。 */
const INTERACTIVE_RULES = [
  '作るのは「1 つの完結した、実際に動くインタラクティブな試作品」です。すべてを単一 HTML に収め、',
  '別ファイル・別画面には分けないこと。',
  'ボタン・タブ・フォーム等の操作は実際に動かすこと。インライン <script> でクリックやイベントに反応させる。',
  '複数の画面/状態が必要な場合は、別ページに分けず、同一ページ内で JS により表示を切り替える',
  '（ビュー切替・モーダル・タブ等）。',
  'このサービスの「主要な動作」は必ずサンプルで実演すること: ユーザーが主要ボタンを押したら、その結果が',
  '実際に画面に現れるようにする。例: サムネ生成ならクリックでサンプルのサムネイルが生成・表示される /',
  '検索なら結果一覧が出る / 送信なら完了状態が出る。ダミーデータでよいが「動いた手応え」が見えること。',
  '画像やサムネ等は、外部ネットワークに依存しないプレースホルダ（CSS で描画した図形・SVG・data URI・',
  'グラデーション等）で見栄え良く表現すること。プレビューは sandbox=allow-scripts で同一オリジン無しのため、',
  '外部画像・外部 API・外部スクリプトへの依存は避ける。',
  '機能や装飾を盛り込みすぎないこと。要望の「主要な動作 1 つ」が動く、要点に絞ったコンパクトな単一画面にする。',
  '生成を速く確実に終わらせるため、HTML を不必要に大きくしない（過剰な画面数・大量のダミーデータは避ける）。',
].join('\n');

/**
 * 新規生成プロンプトを組み立てる。
 * 要望から「1 つの動くインタラクティブな単一 HTML プロトタイプ」を作らせる。
 */
function buildGeneratePrompt(prompt: string): string {
  return [
    'あなたは、動くインタラクティブな試作品を HTML で作るデザイナー兼フロントエンドエンジニアです。',
    '次の要望に対して、実際に操作できる試作品を 1 つ作成してください。',
    '',
    '要望:',
    prompt,
    '',
    INTERACTIVE_RULES,
    '',
    PLAN_RULES,
    '',
    HTML_RULES,
  ].join('\n');
}

/** 反復修正のプロンプトを組み立てる（baseHtml 全体を修正指示で書き換え、HTML 全体を返す）。 */
function buildRevisePrompt(baseHtml: string, instruction: string): string {
  return [
    'あなたは、動くインタラクティブな試作品を HTML で修正するデザイナー兼フロントエンドエンジニアです。',
    '次の指示に従って、以下の HTML 全体を修正してください。修正後の HTML 全体を返します。',
    '修正後も「実際に操作できる動くインタラクティブな HTML」を保つこと（ボタン等は引き続き動かす）。',
    '',
    '指示:',
    instruction,
    '',
    `まず、これから行う修正の「作り方」を平易な日本語で 3〜6 行で説明してください（どこを・どう変えるか・狙い）。`,
    `説明を書き終えたら、次の行に ${PLAN_MARKER} とだけ書いた行を 1 行入れ、その直後の行から修正後の単一 HTML ドキュメント本文だけを出力してください。`,
    '',
    HTML_RULES,
    '',
    '修正対象の HTML:',
    baseHtml,
  ].join('\n');
}

/**
 * 出力から ```html / ``` のコードフェンスを除去し、HTML 本文を取り出す。
 * フェンスが無ければそのまま trim して返す。
 */
function stripFences(out: string): string {
  let s = (out || '').trim();
  // 先頭の ```html / ``` を除去。
  const fenceStart = /^```(?:html|HTML)?\s*\n?/;
  if (fenceStart.test(s)) {
    s = s.replace(fenceStart, '');
    // 末尾の閉じフェンス。
    s = s.replace(/\n?```\s*$/, '');
  }
  return s.trim();
}

/**
 * 出力を「作り方メモ（plan）」と「HTML 本文（html）」に分割する。
 * モデルは PLAN_MARKER（---HTML---）を境にメモ→HTML の順で出力する。
 * - マーカーがまだ来ていない/無い場合: plan は全文、html は ''（＝まだ設計中）。
 *   ただし旧仕様（メモ無しでいきなり HTML）との後方互換のため、本文が HTML タグで
 *   始まっているとみなせる時は html 側に倒す。
 */
function splitPlanHtml(out: string): { plan: string; html: string } {
  const text = out || '';
  const idx = text.indexOf(PLAN_MARKER);
  if (idx !== -1) {
    return { plan: text.slice(0, idx).trim(), html: text.slice(idx + PLAN_MARKER.length) };
  }
  // マーカー未到達: 既に HTML らしき出力が始まっているなら html、まだなら plan とみなす。
  if (/<!DOCTYPE|<html/i.test(text)) return { plan: '', html: text };
  return { plan: text, html: '' };
}

/** claude CLI 1 回ぶんの生実行結果（throw せずここに集約する）。 */
interface RawRun {
  /** stdout 全文（成功・失敗とも。部分出力があれば失敗時も入る）。 */
  stdout: string;
  /** エラー時のメッセージ（成功なら undefined）。stderr の先頭を含める。 */
  error?: string;
  /** タイムアウト kill されたか。 */
  timedOut: boolean;
}

/**
 * claude CLI を指定モデルで 1 回起動し、出力をトークン単位で逐次ストリームする。throw せず RawRun で返す。
 *
 * プレーンな `-p` は結果を最後に一括で吐く（＝逐次表示できない）ため、
 * `--output-format stream-json --include-partial-messages --verbose` を使い、NDJSON の
 * `content_block_delta` からテキスト差分を取り出して積み上げる。onChunk には「これまでの本文全文」を
 * 都度渡す＝呼び出し側が書かれていくコードをライブ表示できる。
 *
 * 共有セマフォ（ノートブック Q&A と同じ枠）の中で実行し、同時実行による利用上限エラーを抑える。
 * 失敗/タイムアウト/NUL ガード後の例外もすべて RawRun.error に集約する（サーバを落とさない）。
 */
function runClaudeRaw(
  prompt: string,
  model: string,
  onChunk?: (accumulated: string) => void,
): Promise<RawRun> {
  // 引数に NUL バイトがあると spawn が throw し得る。想定外の制御文字でサーバを落とさないよう、
  // (1) プロンプトから NUL を除去し、(2) spawn 自体も try/catch で囲う。
  const safePrompt = prompt.replace(/\x00/g, '');
  return withClaudeSlot(
    () =>
      new Promise<RawRun>((resolve) => {
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(
            NOTEBOOK_CLAUDE_BIN,
            [
              '--model',
              model,
              '--output-format',
              'stream-json',
              '--include-partial-messages',
              '--verbose',
              '-p',
              safePrompt,
            ],
            { env: process.env },
          );
        } catch (e) {
          resolve({ stdout: '', timedOut: false, error: `claude 起動失敗: ${(e as Error).message}` });
          return;
        }

        let body = ''; // content_block_delta を積み上げた本文（= 生成中の HTML）。
        let resultText = ''; // result イベントの最終本文（delta が無い場合のフォールバック）。
        let lineBuf = ''; // 行跨ぎ JSON のための未処理バッファ。
        let stderr = '';
        let limitError = ''; // 利用上限を示すイベントを拾ったら入れる（isLimitFailure 用）。
        let resultError = ''; // result イベントが is_error のときの詳細。
        let timedOut = false;
        let settled = false;
        const done = (r: RawRun): void => {
          if (settled) return;
          settled = true;
          resolve(r);
        };

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, GENERATE_TIMEOUT_MS);

        try {
          child.stdin?.end();
        } catch {
          /* noop */
        }

        // NDJSON を 1 行ずつ解釈し、本文差分を積み上げる。
        const handleLine = (line: string): void => {
          const s = line.trim();
          if (!s) return;
          let o: Record<string, unknown>;
          try {
            o = JSON.parse(s) as Record<string, unknown>;
          } catch {
            return; // 壊れた/部分行は無視。
          }
          const type = o.type as string | undefined;
          if (type === 'stream_event') {
            const ev = (o.event ?? {}) as Record<string, unknown>;
            if (ev.type === 'content_block_delta') {
              const delta = (ev.delta ?? {}) as Record<string, unknown>;
              const text = typeof delta.text === 'string' ? delta.text : '';
              if (text && body.length + text.length <= GENERATE_MAX_BUFFER) {
                body += text;
                if (onChunk) onChunk(body);
              }
            }
          } else if (type === 'result') {
            if (typeof o.result === 'string') resultText = o.result;
            if (o.is_error === true) {
              resultError = `claude エラー: ${String(o.subtype ?? 'error')} ${String(o.result ?? '')}`.trim();
            }
          } else if (type === 'rate_limit_event') {
            const info = (o.rate_limit_info ?? {}) as Record<string, unknown>;
            // status が allowed 以外（rejected/blocked 等）なら利用上限とみなす。
            if (typeof info.status === 'string' && info.status !== 'allowed') {
              limitError = `rate limit: ${info.status}`;
            }
          }
        };

        child.stdout?.on('data', (chunk: Buffer) => {
          lineBuf += chunk.toString();
          let nl: number;
          while ((nl = lineBuf.indexOf('\n')) !== -1) {
            const line = lineBuf.slice(0, nl);
            lineBuf = lineBuf.slice(nl + 1);
            handleLine(line);
          }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          if (lineBuf.trim()) handleLine(lineBuf); // 残りの最終行。
          const out = body || resultText;
          if (timedOut) {
            done({
              stdout: out,
              timedOut: true,
              error: `claude タイムアウト（${Math.round(GENERATE_TIMEOUT_MS / 1000)}s）`,
            });
            return;
          }
          // 利用上限・result エラーは error に載せる（isLimitFailure が error 文字列を見て fallback 判定）。
          if (limitError) {
            done({ stdout: out, timedOut: false, error: limitError });
            return;
          }
          if (code !== 0) {
            const detail = stderr ? ` | ${stderr.slice(0, 500)}` : '';
            done({ stdout: out, timedOut: false, error: `claude 実行失敗（終了コード ${code}）${detail}` });
            return;
          }
          if (resultError) {
            done({ stdout: out, timedOut: false, error: resultError });
            return;
          }
          done({ stdout: out, timedOut: false });
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          done({ stdout: body || resultText, timedOut: false, error: `claude 実行失敗: ${err.message}` });
        });
      }),
  );
}

/**
 * 失敗が「利用上限（Sonnet limit / usage limit / rate limit 等）」由来かを判定する。
 * notebookClaude.isLimitFailure と同じ語彙。検出したら fallback（Opus）へ切替える。大文字小文字無視。
 */
function isLimitFailure(r: RawRun): boolean {
  const h = `${r.stdout || ''}\n${r.error || ''}`.toLowerCase();
  if (h.includes('hit your') && h.includes('limit')) return true;
  return (
    h.includes('usage limit') ||
    h.includes('rate limit') ||
    h.includes('rate_limit') ||
    h.includes('rate-limited') ||
    h.includes('reached your') ||
    (h.includes('exceeded') && h.includes('limit'))
  );
}

// ─── 非同期ジョブストア ──────────────────────────────────
//
// Cloudflare エッジ（cloudflared トンネル）には約 100s の上限があり、claude CLI が
// 競合等で遅いと 524 になる。生成をバックグラウンドジョブ化し、POST は即 202 で jobId を返し、
// フロントは GET /job/:id をポーリングする。これでエッジ上限に縛られなくなる。
// ジョブはインメモリ（プロセス再起動で消える）。

type JobStatus = 'pending' | 'generating' | 'done' | 'error';
interface Job {
  status: JobStatus;
  /** 生成された HTML。 */
  html?: string;
  /** 生成途中の部分 HTML（ストリーム中の最新 stdout。ライブ表示用）。 */
  partial?: string;
  /** 生成途中の「作り方」メモ（HTML を書き始める前の設計説明。ライブ表示用）。 */
  plan?: string;
  error?: string;
  /** 保存先 id（クライアントが currentId に反映できる）。 */
  mockupId?: string;
  /** 自動保存できた結果（単一画面でも [{id,title}] 1 件を入れて後方互換を保つ）。 */
  saved?: { id: string; title: string }[];
  createdAt: number;
}

/** jobId → Job。インメモリのみ。 */
const jobs = new Map<string, Job>();

/** ジョブの保持期間（15 分）。これより古いものは破棄する。 */
const JOB_TTL_MS = 15 * 60_000;

/**
 * サーバ側リトライ: 最大試行回数と試行間バックオフ。エッジ上限から外れたので安全に複数回試せる。
 * 3 回にして「一過性失敗の再試行」と「利用上限時の Opus フォールバック」の両方に枠を確保する。
 */
const GENERATE_MAX_ATTEMPTS = 3;
const GENERATE_RETRY_BACKOFF_MS = 5_000;

/** 生成失敗の分類。原因に応じてユーザ向けメッセージを変える。 */
type GenFailReason = 'limit' | 'timeout' | 'empty' | 'error';

/** 生成の結果。html が取れれば html、ダメなら reason（＋デバッグ用 detail）。 */
interface GenResult {
  html: string | null;
  reason?: GenFailReason;
  detail?: string;
}

/** 分類ごとのユーザ向け失敗メッセージ（原因が分かるように出し分ける）。 */
const GENERATE_FAILURE_MESSAGES: Record<GenFailReason, string> = {
  limit:
    '生成エンジンが利用上限に達しました（フォールバックでも生成できませんでした）。時間をおいて再度お試しください。',
  timeout:
    '生成がタイムアウトしました。要望を短く・具体的にしてから再度お試しください。',
  empty:
    '生成エンジンが有効な HTML を返しませんでした。要望をもう少し具体的にして再度お試しください。',
  error:
    '生成に失敗しました。生成エンジンが混み合っているか一時的に失敗した可能性があります。少し待ってもう一度お試しください。',
};

/** 互換用エイリアス（汎用失敗時のデフォルト文言）。 */
const GENERATE_FAILURE_MESSAGE = GENERATE_FAILURE_MESSAGES.error;

/** TTL を過ぎたジョブを破棄する（アクセス時に呼ぶ・サーバを汚さない）。 */
function sweepExpiredJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * claude CLI で HTML を 1 本生成し、フェンス除去 + 最低限の妥当性チェックまで行う。
 * 堅牢化（エラー画面に落とさない）のための多層防御:
 *  - 一過性失敗（空応答・claude 競合・タイムアウト）を吸収するため最大 GENERATE_MAX_ATTEMPTS 回リトライ。
 *  - 利用上限（Sonnet limit / rate limit 等）を検出したら、以降の試行を fallback（Opus）へ切替える。
 *  - 失敗時は原因を分類（limit/timeout/empty/error）して返し、ユーザに出し分けできるようにする。
 * 成功した HTML を { html } で返す。全試行失敗なら { html:null, reason, detail }。
 */
async function generateHtmlWithRetry(
  cliPrompt: string,
  onChunk?: (accumulated: string) => void,
): Promise<GenResult> {
  let model = NOTEBOOK_CLAUDE_MODEL; // primary（Sonnet）。利用上限検出で fallback（Opus）へ。
  let switchedToFallback = false;
  let lastReason: GenFailReason = 'error';
  let lastDetail: string | undefined;

  for (let attempt = 1; attempt <= GENERATE_MAX_ATTEMPTS; attempt += 1) {
    const raw = await runClaudeRaw(cliPrompt, model, onChunk);

    if (!raw.error) {
      // 「作り方メモ → ---HTML--- → HTML 本文」のうち HTML 本文だけを取り出す。
      const html = stripFences(splitPlanHtml(raw.stdout).html);
      // HTML らしさの最低限チェック: 空・タグを含まないものは無効（リトライ対象）。
      if (html && html.includes('<')) return { html };
      // 応答はあるが HTML ではない（空・フェンスのみ等）。
      lastReason = 'empty';
      lastDetail = undefined;
    } else if (isLimitFailure(raw)) {
      lastReason = 'limit';
      lastDetail = raw.error;
      // 利用上限。まだ primary なら次回以降は fallback（Opus）へ切替える。
      if (!switchedToFallback) {
        switchedToFallback = true;
        model = DEV_MOCKUP_FALLBACK_MODEL;
        console.warn(
          `[dev-mockup] sonnet limit hit → fallback to ${DEV_MOCKUP_FALLBACK_MODEL}`,
        );
      }
    } else if (raw.timedOut) {
      // タイムアウト＝出力が重すぎる/詰まっている。再試行してもまた 240s 待たせるだけなので即諦める。
      lastReason = 'timeout';
      lastDetail = raw.error;
      if (lastDetail) console.warn(`[dev-mockup] generate attempt ${attempt} timed out → 中断`);
      break;
    } else {
      lastReason = 'error';
      lastDetail = raw.error;
    }

    if (lastDetail) console.warn(`[dev-mockup] generate attempt ${attempt} failed: ${lastDetail}`);
    // 最終試行でなければバックオフして再試行。
    if (attempt < GENERATE_MAX_ATTEMPTS) await sleep(GENERATE_RETRY_BACKOFF_MS);
  }
  return { html: null, reason: lastReason, detail: lastDetail };
}

// ─── dev 生成の直列化 ────────────────────────────────────────
//
// 共有 Claude アカウントで重い HTML 生成を同時に走らせると互いに遅くなり 240s 上限に達しやすい
// （実測: 単発 ~10〜90s が、2 本同時だと両方 240s タイムアウト）。dev 生成は 1 本ずつ直列化する。
// 後続は前段の完了を待ってから走る＝各々が速く確実に終わり、全体スループットも結局上がる。
// 注: 直列化は dev 生成同士のみ。ノートブック Q&A とは withClaudeSlot（共有セマフォ）側で調停する。

let devGenChain: Promise<unknown> = Promise.resolve();

/** fn を dev 生成チェーンの末尾に繋いで直列実行する。結果/例外は呼び出し側へ素通し。 */
function serializeDevGen<T>(fn: () => Promise<T>): Promise<T> {
  const run = devGenChain.then(fn, fn);
  // チェーン自体は「次が待てる」ためだけのもの。成否を握り潰して後続を止めない。
  devGenChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * バックグラウンドで claude CLI を呼んで HTML を生成し、結果をジョブに格納する（単一画面）。
 * 新規生成（prompt）・修正（baseHtml + instruction）の両方で使う。
 * await しない前提。例外でサーバを落とさない。
 */
async function runGenerateJob(
  jobId: string,
  cliPrompt: string,
  save: { title: string; id?: string; prompt?: string },
): Promise<void> {
  // 生成途中の stdout をジョブへ反映＝クライアントがポーリングでライブにコードを見られる。
  const onChunk = (accumulated: string): void => {
    const job = jobs.get(jobId);
    if (!job || job.status === 'done' || job.status === 'error') return;
    job.status = 'generating';
    // 「作り方メモ」と「HTML 本文」に分割して別々に持つ。クライアントは HTML が来るまで
    // メモを “作り方を考えています” のライブ表示に使い、HTML が始まったらコードに切り替える。
    const { plan, html } = splitPlanHtml(accumulated);
    job.plan = plan || undefined;
    job.partial = html;
  };
  // 同時実行の食い合いを避けるため、生成は 1 本ずつ直列化する。
  // 直列キューに並んでいる間は status='pending'（=順番待ち）、自分の番が来て実際に
  // claude を起動する瞬間に status='generating' へ。クライアントは両者を区別して
  // 「順番待ち中」か「生成中（考え中→コード書き中）」かを正しく表示できる。
  const result = await serializeDevGen(() => {
    const job = jobs.get(jobId);
    if (job && job.status === 'pending') job.status = 'generating';
    return generateHtmlWithRetry(cliPrompt, onChunk);
  });
  if (result.html) {
    const html = result.html;
    // 生成成功。クライアントが離脱・通信失敗しても結果が残るよう、ストアへ自動保存する。
    // 保存に失敗してもジョブ自体は成功として html を返す（保存はベストエフォート）。
    let mockupId: string | undefined;
    try {
      const saved = upsertMockup({
        id: save.id,
        title: save.title,
        html,
        prompt: save.prompt,
      });
      mockupId = saved.id;
    } catch {
      // ignore — html は返す。
    }
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'done';
      job.html = html;
      job.mockupId = mockupId;
      // 後方互換: 保存できたら saved を 1 件で埋める。
      if (mockupId) job.saved = [{ id: mockupId, title: save.title }];
    }
    return;
  }

  // 全試行失敗。原因を分類してユーザ向け文言を出し分ける。
  const job = jobs.get(jobId);
  if (job) {
    job.status = 'error';
    job.error = GENERATE_FAILURE_MESSAGES[result.reason ?? 'error'];
  }
}

// ─── ハンドラ ───────────────────────────────────────────

/** POST /api/dev/mockup/generate — 非同期ジョブを起票し 202 { jobId } を即返す。 */
function handleGenerate(req: Request, res: Response): void {
  sweepExpiredJobs();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const baseHtml = typeof body.baseHtml === 'string' ? body.baseHtml : '';
  const instruction = typeof body.instruction === 'string' ? body.instruction : '';

  // モード判定: baseHtml + instruction が両方あれば反復修正、prompt のみなら新規生成。
  // どちらも「1 つの動くインタラクティブな単一 HTML」を生成する。
  const isRevise = Boolean(baseHtml.trim() && instruction.trim());
  const isGenerate = !isRevise && Boolean(prompt.trim());
  if (!isRevise && !isGenerate) {
    res.status(400).json({ error: 'prompt（新規生成）または baseHtml+instruction（修正）が必要です' });
    return;
  }

  const jobId = randomUUID();
  jobs.set(jobId, { status: 'pending', createdAt: Date.now() });

  const onFatal = (): void => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = GENERATE_FAILURE_MESSAGE;
    }
  };

  const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 40);
  const explicitTitle = typeof body.title === 'string' ? body.title.trim() : '';
  const explicitId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;

  if (isGenerate) {
    // 新規生成: 動くインタラクティブな単一 HTML を 1 本生成して自動保存。
    const cliPrompt = buildGeneratePrompt(prompt.trim());
    void runGenerateJob(jobId, cliPrompt, {
      title: explicitTitle || oneLine(prompt) || 'モックアップ',
      prompt: prompt.trim(),
    }).catch(onFatal);
  } else {
    // 修正: 単一画面。自動保存用のタイトルと対象 id を決める。
    const autoTitle = explicitTitle || (instruction.trim() ? `修正: ${oneLine(instruction)}` : 'モックアップ');
    const storePrompt = instruction.trim() || undefined;
    const cliPrompt = buildRevisePrompt(baseHtml, instruction);
    void runGenerateJob(jobId, cliPrompt, {
      title: autoTitle,
      id: explicitId,
      prompt: storePrompt,
    }).catch(onFatal);
  }

  // 即座に 202 を返す＝リクエストは短時間で完了し、エッジ上限に掛からない。
  res.status(202).json({ jobId });
}

/** GET /api/dev/mockup/job/:jobId — ジョブの状態を返す。未知/期限切れは 404。 */
function handleJob(req: Request, res: Response): void {
  sweepExpiredJobs();
  const jobId = String(req.params.jobId);
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  res.json({
    status: job.status,
    html: job.html,
    // 生成途中の部分コード（フェンスを除いて返す）。done になれば html を使うので不要。
    partial: job.status === 'generating' && job.partial ? stripFences(job.partial) : undefined,
    // 生成途中の「作り方」メモ（HTML を書き始める前に表示する設計説明）。
    plan: job.status === 'generating' && job.plan ? job.plan : undefined,
    mockupId: job.mockupId,
    error: job.error,
    saved: job.saved,
  });
}

/** GET /api/dev/mockups — 軽量サマリ一覧（html 除く）。 */
function handleList(_req: Request, res: Response): void {
  res.json({ mockups: listMockups() });
}

/** GET /api/dev/mockups/:id — html を含む 1 件。 */
function handleGet(req: Request, res: Response): void {
  const id = String(req.params.id);
  const mockup = getMockup(id);
  if (!mockup) {
    res.status(404).json({ error: 'mockup not found' });
    return;
  }
  res.json({ mockup });
}

/** POST /api/dev/mockups — upsert（id 無ければ生成）。 */
function handleUpsert(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  const html = typeof body.html === 'string' ? body.html : '';
  if (!html) {
    res.status(400).json({ error: 'html is required' });
    return;
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
  const prompt = typeof body.prompt === 'string' ? body.prompt : undefined;

  const saved = upsertMockup({ id, title, html, prompt });
  res.json({ mockup: saved });
}

/** DELETE /api/dev/mockups/:id — 論理削除。 */
function handleDelete(req: Request, res: Response): void {
  const id = String(req.params.id);
  deleteMockup(id);
  res.json({ ok: true, id });
}

// ─── Router 組み立て ─────────────────────────────────────

/** /api/dev 配下のルータを返す。index.ts で auth ミドルウェア配下に mount する。 */
export function devMockupRouter(): Router {
  const router = Router();
  router.post('/mockup/generate', handleGenerate);
  router.get('/mockup/job/:jobId', handleJob);
  router.get('/mockups', handleList);
  router.get('/mockups/:id', handleGet);
  router.post('/mockups', handleUpsert);
  router.delete('/mockups/:id', handleDelete);
  return router;
}
