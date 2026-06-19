// devFigmaWireframes — 開発ページの「Figma ワイヤーフレーム生成」ステージ。
//
// Apollo サーバから claude CLI を Figma MCP（claude.ai 連携・mcp.figma.com）付きで起動し、
// 設計書と画面リストを元に、新規 Figma ファイルに各画面のワイヤーフレームを作らせる。
// 各フレームは get_screenshot の短命 URL を curl で PNG 保存し、Apollo 側で表示できるようにする。
//
// 返り値（マニフェスト）:
//   { ok, fileKey, fileUrl, screens:[{ name, nodeId, image:"<n>.png" }] }
//
// 画像は DEV_WIREFRAMES_DIR/<jobId>/<n>.png に保存（data/ 配下・.gitignore 済み）。
// claude は stream-json で起動し、tool_use イベントを進捗（onProgress）に流す。
// 失敗してもサーバを落とさず { ok:false, error } を返す（生成パイプラインがフォールバックできる）。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { NOTEBOOK_CLAUDE_BIN, NOTEBOOK_CLAUDE_MODEL, DEV_WIREFRAMES_DIR } from '../config.js';
import { withClaudeSlot } from './notebookClaude.js';

/** 1 画面ぶんの入力仕様（設計書ステージが洗い出す）。 */
export interface WireframeScreenSpec {
  /** 画面名（フレーム名にもなる。例: "ホーム" / "詳細"）。 */
  name: string;
  /** その画面に何を置くか・何ができるかの説明。 */
  description: string;
}

/** 1 画面ぶきの生成結果。 */
export interface WireframeScreenResult {
  name: string;
  /** Figma フレームの node id。 */
  nodeId?: string;
  /** 保存した PNG のファイル名（<jobId> ディレクトリ内）。取得できなければ undefined。 */
  image?: string;
}

/** Figma ワイヤーフレーム生成の結果。 */
export interface FigmaWireframeResult {
  ok: boolean;
  fileKey?: string;
  fileUrl?: string;
  screens: WireframeScreenResult[];
  error?: string;
}

/** Figma 生成で claude に許可するツール（Figma MCP + スクショ保存用の curl のみ）。 */
const FIGMA_ALLOWED_TOOLS = [
  'mcp__claude_ai_Figma__whoami',
  'mcp__claude_ai_Figma__create_new_file',
  'mcp__claude_ai_Figma__use_figma',
  'mcp__claude_ai_Figma__get_screenshot',
  'mcp__claude_ai_Figma__get_metadata',
  'Bash(curl:*)',
];

/** Figma 生成 1 回あたりのタイムアウト。
 *  Figma MCP は 1 画面 ~150-200s と遅く、10 分枠だと「終わらないのに 10 分待たせて結局スキップ→その後
 *  コード段も時間切れ」となっていた（実測: 3 画面で 600s タイムアウト）。早めに見切ってコード段へ進める
 *  よう 6 分に短縮。失敗してもジョブは続行＝ワイヤーフレームは省略されコードは作られる。 */
const FIGMA_TIMEOUT_MS = 360_000;

/** バッファ上限（マニフェスト JSON + ツールログで膨らむため広め）。 */
const FIGMA_MAX_BUFFER = 16 * 1024 * 1024;

/** ツール名 → ユーザ向け進捗メッセージ（未経験者にも分かる平易な日本語）。 */
function toolProgressLabel(tool: string, figmaCalls: number): string | null {
  if (tool.endsWith('create_new_file')) return '🎨 Figma に新しいデザインファイルを用意しています';
  if (tool.endsWith('use_figma')) return `🖼 Figma でワイヤーフレームを描いています（${figmaCalls} 画面目）`;
  if (tool.endsWith('get_screenshot')) return '📸 描いたワイヤーフレームを画像に書き出しています';
  if (tool.startsWith('Bash')) return '⬇️ ワイヤーフレーム画像を取り込んでいます';
  if (tool.endsWith('whoami')) return '🔌 Figma に接続しています';
  return null;
}

/** 出力テキストから最後の JSON オブジェクト（```json ブロック優先）を取り出す。 */
function extractManifest(text: string): Record<string, unknown> | null {
  const t = text || '';
  // ```json ... ``` を優先。
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/gi);
  const candidates: string[] = [];
  if (fence) {
    for (const block of fence) {
      candidates.push(block.replace(/```(?:json)?\s*/i, '').replace(/```$/, '').trim());
    }
  }
  // フェンスが無ければ、最後の { から末尾の } までを候補にする。
  const lastOpen = t.lastIndexOf('{');
  const lastClose = t.lastIndexOf('}');
  if (lastOpen !== -1 && lastClose > lastOpen) candidates.push(t.slice(lastOpen, lastClose + 1));
  // 後ろの候補（最終出力に近い）から順に parse を試す。
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const o = JSON.parse(candidates[i]) as Record<string, unknown>;
      if (o && typeof o === 'object' && Array.isArray((o as { screens?: unknown }).screens)) return o;
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

/** claude に渡す Figma 生成プロンプトを組み立てる。 */
function buildFigmaPrompt(
  appTitle: string,
  spec: string,
  screens: WireframeScreenSpec[],
  outDir: string,
): string {
  const screenLines = screens
    .map((s, i) => `${i + 1}. ${s.name}: ${s.description}`)
    .join('\n');
  return [
    'あなたは Figma MCP を使える UI デザイナーです。次の設計書を元に、Figma 上にモバイル向けの',
    'ワイヤーフレームを作成してください。手順を厳密に守ること。',
    '',
    `アプリ名: ${appTitle}`,
    '',
    '設計書:',
    spec,
    '',
    `作成する画面（${screens.length} 画面。各画面を必ず 1 フレームとして作る）:`,
    screenLines,
    '',
    '手順:',
    '1. create_new_file で新規 Figma ファイルを作成（名前: 「' + appTitle + ' ワイヤーフレーム」）。',
    '2. 簡易デザインシステムを決める（背景・面・文字・アクセントの色を各1〜2色、角丸、余白、文字サイズ）。',
    '   全画面でこの統一トークンを使い、最終的なコードがダサくならない土台にする。低〜中精細で良い。',
    '3. 画面ごとに、幅 390px のモバイルフレームを auto-layout で作成する。フレーム名は画面名にする。',
    '   各画面の説明に沿って、ヘッダ・主要ボタン・リスト/入力欄などの主要部品を配置する。',
    '   実データは不要。レイアウトと情報設計が伝わればよい（プレースホルダのテキスト/グレーの枠でよい）。',
    '4. 1 フレーム作るごとに get_screenshot でそのフレームの画像 URL を取得し、すぐに curl で PNG 保存する:',
    `   curl -sL -o ${outDir}/<画面番号>.png "<image_url>"  （画面番号は上のリストの番号 1,2,3,...）`,
    `   保存先ディレクトリ ${outDir} は既に存在する。`,
    '5. すべての画面を作り終えたら、最後に次の厳密な JSON だけを ```json コードブロックで出力する',
    '   （余計な説明は最小限・JSON が最後に来るようにする）:',
    '{',
    '  "fileKey": "<Figmaファイルキー>",',
    '  "fileUrl": "https://www.figma.com/design/<fileKey>",',
    '  "screens": [',
    '    { "name": "<画面名>", "nodeId": "<フレームのnode id>", "image": "1.png" }',
    '  ]',
    '}',
    '',
    '注意: use_figma の各スクリプトは状態を持ち越せないので、毎回 hex→rgb 変換や対象ページ取得を冒頭で行う。',
    'appendChild してから layoutSizing 系を設定する。失敗したら一度だけ作り直す。',
  ].join('\n');
}

/**
 * Figma にワイヤーフレームを生成し、各画面の PNG を <jobId> ディレクトリへ保存する。
 * onProgress には進捗メッセージ（ツール実行ベース）を流す。throw せず結果オブジェクトを返す。
 */
export function generateFigmaWireframes(
  jobId: string,
  appTitle: string,
  spec: string,
  screens: WireframeScreenSpec[],
  model: string = NOTEBOOK_CLAUDE_MODEL,
  onProgress?: (msg: string) => void,
): Promise<FigmaWireframeResult> {
  const outDir = join(DEV_WIREFRAMES_DIR, jobId);
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (e) {
    return Promise.resolve({
      ok: false,
      screens: [],
      error: `保存先の作成に失敗: ${(e as Error).message}`,
    });
  }

  const prompt = buildFigmaPrompt(appTitle, spec, screens, outDir);

  return withClaudeSlot(
    () =>
      new Promise<FigmaWireframeResult>((resolve) => {
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
              '--allowedTools',
              ...FIGMA_ALLOWED_TOOLS,
              '-p',
              prompt,
            ],
            { env: process.env },
          );
        } catch (e) {
          resolve({ ok: false, screens: [], error: `claude 起動失敗: ${(e as Error).message}` });
          return;
        }

        let body = ''; // text デルタ + result の最終本文。
        let resultText = '';
        let lineBuf = '';
        let stderr = '';
        let figmaCalls = 0; // use_figma 呼び出し数（進捗の「N画面目」用）。
        let timedOut = false;
        let settled = false;
        const finish = (r: FigmaWireframeResult): void => {
          if (settled) return;
          settled = true;
          resolve(r);
        };

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, FIGMA_TIMEOUT_MS);

        try {
          child.stdin?.end();
        } catch {
          /* noop */
        }

        const handleLine = (line: string): void => {
          const s = line.trim();
          if (!s) return;
          let o: Record<string, unknown>;
          try {
            o = JSON.parse(s) as Record<string, unknown>;
          } catch {
            return;
          }
          const type = o.type as string | undefined;
          if (type === 'stream_event') {
            const ev = (o.event ?? {}) as Record<string, unknown>;
            if (ev.type === 'content_block_delta') {
              const delta = (ev.delta ?? {}) as Record<string, unknown>;
              const text = typeof delta.text === 'string' ? delta.text : '';
              if (text && body.length + text.length <= FIGMA_MAX_BUFFER) body += text;
            } else if (ev.type === 'content_block_start') {
              const block = (ev.content_block ?? {}) as Record<string, unknown>;
              if (block.type === 'tool_use') {
                const name = typeof block.name === 'string' ? block.name : '';
                if (name.endsWith('use_figma')) figmaCalls += 1;
                const label = toolProgressLabel(name, figmaCalls);
                if (label && onProgress) onProgress(label);
              }
            }
          } else if (type === 'result') {
            if (typeof o.result === 'string') resultText = o.result;
          }
        };

        child.stdout?.on('data', (chunk: Buffer) => {
          lineBuf += chunk.toString();
          let nl: number;
          while ((nl = lineBuf.indexOf('\n')) !== -1) {
            const ln = lineBuf.slice(0, nl);
            lineBuf = lineBuf.slice(nl + 1);
            handleLine(ln);
          }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          if (lineBuf.trim()) handleLine(lineBuf);
          if (timedOut) {
            finish({ ok: false, screens: [], error: `Figma 生成タイムアウト（${FIGMA_TIMEOUT_MS / 1000}s）` });
            return;
          }
          const out = resultText || body;
          const manifest = extractManifest(out);
          if (!manifest) {
            const detail = stderr ? ` | ${stderr.slice(0, 300)}` : '';
            finish({
              ok: false,
              screens: [],
              error: `Figma 生成の結果を解釈できませんでした（code ${code}）${detail}`,
            });
            return;
          }
          // マニフェストを検証し、保存された PNG が実在するものだけ image に採用する。
          const rawScreens = Array.isArray(manifest.screens) ? (manifest.screens as unknown[]) : [];
          const resultScreens: WireframeScreenResult[] = rawScreens.map((rs) => {
            const r = (rs ?? {}) as Record<string, unknown>;
            const name = typeof r.name === 'string' ? r.name : '';
            const nodeId = typeof r.nodeId === 'string' ? r.nodeId : undefined;
            const image = typeof r.image === 'string' ? r.image : undefined;
            const imageOk = image && existsSync(join(outDir, image)) ? image : undefined;
            return { name, nodeId, image: imageOk };
          });
          finish({
            ok: true,
            fileKey: typeof manifest.fileKey === 'string' ? manifest.fileKey : undefined,
            fileUrl: typeof manifest.fileUrl === 'string' ? manifest.fileUrl : undefined,
            screens: resultScreens,
          });
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          finish({ ok: false, screens: [], error: `claude 実行失敗: ${err.message}` });
        });
      }),
  );
}
