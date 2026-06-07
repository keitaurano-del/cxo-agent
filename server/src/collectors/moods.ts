// moods collector — エージェントの「今の気持ち＋考えてること」を一人称で生成（MC-165 拡張）。
//
// AgentsLive の各カードに、定型文でなく実際の直近活動（lastAction / currentTask）に基づく一人称の
// 気持ち（感情絵文字）＋考えてること（1 行）を表示するためのデータを返す。
//
// コスト厳守の設計:
//   - 全 active エージェントぶんを 1 回のバッチ claude 呼び出し（haiku）で生成する（連打しない）。
//   - 活動（key+lastAction+currentTask）のハッシュでキャッシュし、変化が無ければ再生成しない。
//   - 直前生成から最短 AGENT_MOOD_THROTTLE_MS（既定 5 分）は、変化があっても再生成しない。
//   - active が 0 なら claude を一切呼ばない。
//   - 失敗・タイムアウト・パース不可は status ベースの簡易ムードにフォールバック（claude を呼ばない）。
//
// 出力（/api/agent-moods）: { key, emoji, mood, thought, doing }[]。
//   - key   : subagentType（agents）または 'secretary:<key>'（秘書）。frontend が突合する。
//   - emoji : 感情絵文字。
//   - mood  : 一人称の今の気持ち（短句）。
//   - thought: 考えてること（1 行）。
//   - doing : いま「どのタスクの何をしているか」を具体的に表す一人称 1〜2 行（主役）。
//             currentTask のタイトル＋lastAction を根拠に具体化する（active 向け）。

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  NOTEBOOK_CLAUDE_BIN,
  AGENT_MOOD_MODEL,
  AGENT_MOOD_TIMEOUT_MS,
  AGENT_MOOD_THROTTLE_MS,
} from '../config.js';
import type { AgentStatus } from '../lib/stall.js';

/** mood 生成の入力 1 件（active なエージェント / 秘書）。 */
export interface MoodInput {
  /** 突合キー（subagentType または 'secretary:masayoshi' 等）。 */
  key: string;
  /** 表示名（プロンプトの一人称の主体）。 */
  name: string;
  /** ステータス（フォールバック用）。 */
  status: AgentStatus;
  /** 直近の一言（生成の根拠）。 */
  lastAction?: string;
  /** 現在のタスク（ID＋タイトル。例「MC-191 図解 SVG を実装」。生成の根拠）。 */
  currentTask?: string;
}

/** mood 生成の出力 1 件。 */
export interface AgentMood {
  key: string;
  emoji: string;
  /** 今の気持ち（一人称の短句）。 */
  mood: string;
  /** 考えてること（1 行）。 */
  thought: string;
  /** いま「どのタスクの何をしているか」を具体的に表す一人称 1〜2 行（主役）。 */
  doing: string;
}

// ─── キャッシュ／スロットル状態 ─────────────────────────────────

let cachedMoods: AgentMood[] = [];
let cachedHash = '';
let cachedAt = 0;
let inflight: Promise<AgentMood[]> | null = null;

/** 入力集合から再生成要否を決めるハッシュ（key+lastAction+currentTask の集合）。 */
function inputsHash(inputs: MoodInput[]): string {
  const norm = inputs
    .map((i) => `${i.key}${i.lastAction ?? ''}${i.currentTask ?? ''}`)
    .sort()
    .join('');
  return createHash('sha1').update(norm).digest('hex');
}

/** status ベースの簡易ムード（フォールバック・claude を呼ばない）。 */
function fallbackMood(input: MoodInput): AgentMood {
  switch (input.status) {
    case 'active': {
      // active のフォールバックは、根拠（currentTask / lastAction）があれば doing に具体化する。
      const target = input.currentTask?.trim();
      const action = input.lastAction?.trim();
      const doing = target
        ? action
          ? `${target} を進行中。${action}`
          : `${target} を進行中。`
        : action || '今の作業を進めています。';
      return {
        key: input.key,
        emoji: '🔧',
        mood: '集中',
        thought: '手を動かしています。',
        doing: doing.slice(0, 120),
      };
    }
    case 'done':
      return { key: input.key, emoji: '✨', mood: '達成', thought: 'ひと区切りつきました。', doing: '' };
    case 'idle':
      return { key: input.key, emoji: '😌', mood: '待機', thought: '次の指示を待っています。', doing: '' };
    default:
      return { key: input.key, emoji: '😴', mood: '休止', thought: '今は動いていません。', doing: '' };
  }
}

/** 全入力ぶんのフォールバックムード一覧。 */
function fallbackAll(inputs: MoodInput[]): AgentMood[] {
  return inputs.map(fallbackMood);
}

/** バッチ生成プロンプトを組み立てる。 */
function buildPrompt(inputs: MoodInput[]): string {
  const items = inputs.map((i, idx) => {
    const parts = [`${idx + 1}. key="${i.key}" 名前="${i.name}"`];
    if (i.currentTask) parts.push(`現在のタスク: ${i.currentTask}`);
    if (i.lastAction) parts.push(`直近の活動: ${i.lastAction}`);
    return parts.join(' / ');
  });
  return [
    'あなたは複数の AI エージェントが「いまどのタスクの何をしているか」を、各自の直近の活動に基づいて一人称で言語化する役です。',
    '以下の各エージェントについて、現在のタスク（ID とタイトル）と直近の活動を根拠に、本人が今まさに取り組んでいる具体的な作業内容を一人称で作ってください。',
    '主役は「どのタスクの・何を」しているかです。気持ちは添える程度にします。',
    '',
    '制約:',
    '- doing（最重要）: いま「どのタスクの何をしているか」を一人称（私/僕など本人視点）で具体的に 1〜2 行・60 文字以内。',
    '    現在のタスクがあれば必ず先頭に「MC-xxx」のような ID を含め、タイトルと直近の活動から「何を」している段階かを具体的に書く。',
    '    例「MC-191 の図解 SVG を実装中。あと少しで噛み合いそう」。定型文・抽象語（「作業中」だけ等）は禁止。',
    '- emoji: 作業や気持ちに合う絵文字 1 つ（例 🔧 🔍 🧪 ✍️ 🤔 😀 ✨ 🔥）。',
    '- mood: 今の気持ちを表す 1〜6 文字の短い日本語（例「集中」「悩み中」「手応えあり」）。',
    '- thought: 一人称の短い気持ちのつぶやき 1 行・30 文字以内。doing と重複させない。',
    '- 活動情報が乏しい場合は無理に捏造せず、現在のタスク ID と分かる範囲だけを正直に書く。',
    '- 口調は各自を尊重しつつ自然に。',
    '',
    'エージェント一覧:',
    ...items,
    '',
    '出力は次の JSON 配列のみ（前後に説明や ``` を付けない）:',
    '[{"key":"...","emoji":"...","mood":"...","thought":"...","doing":"..."}]',
  ].join('\n');
}

/** claude stdout から JSON 配列を抽出してパースする（前後ノイズ・``` 耐性）。 */
function parseMoods(stdout: string, inputs: MoodInput[]): AgentMood[] | null {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;

  const byKey = new Map<string, AgentMood>();
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const key = typeof r.key === 'string' ? r.key : '';
    if (!key) continue;
    byKey.set(key, {
      key,
      emoji: typeof r.emoji === 'string' && r.emoji.trim() ? r.emoji.trim().slice(0, 4) : '🤔',
      mood: typeof r.mood === 'string' ? r.mood.trim().slice(0, 12) : '',
      thought: typeof r.thought === 'string' ? r.thought.trim().slice(0, 80) : '',
      doing: typeof r.doing === 'string' ? r.doing.trim().slice(0, 120) : '',
    });
  }
  // 入力順に整列し、欠けた key はフォールバックで埋める（全件返す）。
  return inputs.map((i) => byKey.get(i.key) ?? fallbackMood(i));
}

/** claude をバッチ起動して mood を生成する（1 回呼び出し）。失敗は null。 */
function runBatch(inputs: MoodInput[]): Promise<AgentMood[] | null> {
  return new Promise((resolve) => {
    execFile(
      NOTEBOOK_CLAUDE_BIN,
      ['--model', AGENT_MOOD_MODEL, '-p', buildPrompt(inputs)],
      { timeout: AGENT_MOOD_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: process.env },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve(parseMoods((stdout || '').toString(), inputs));
      },
    );
  });
}

/**
 * active エージェント/秘書の mood を返す。
 *
 * - inputs が空（active 0）なら claude を呼ばず空配列。
 * - 入力ハッシュが前回と同じ、またはスロットル時間内なら、前回の生成結果を返す。
 * - それ以外は 1 回バッチ生成。失敗時は status フォールバックを返す（次回再試行のためキャッシュは更新しない）。
 * - 同時要求は inflight Promise を共有して二重起動しない。
 */
export async function collectMoods(inputs: MoodInput[]): Promise<AgentMood[]> {
  if (inputs.length === 0) {
    cachedMoods = [];
    cachedHash = '';
    return [];
  }

  const hash = inputsHash(inputs);
  const now = Date.now();

  // ハッシュ一致（活動に変化なし）→ 再生成しない。
  if (hash === cachedHash && cachedMoods.length > 0) return cachedMoods;
  // スロットル時間内 → 変化があっても再生成しない（前回値を返す。無ければフォールバック）。
  if (cachedAt > 0 && now - cachedAt < AGENT_MOOD_THROTTLE_MS) {
    return cachedMoods.length > 0 ? cachedMoods : fallbackAll(inputs);
  }
  // 既に生成中なら相乗り（二重 claude 起動を避ける）。
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const result = await runBatch(inputs);
      if (result && result.length > 0) {
        cachedMoods = result;
        cachedHash = hash;
        cachedAt = Date.now();
        return result;
      }
      // 生成失敗: フォールバックを返すが、キャッシュ（hash/at）は更新しない＝次回再試行する。
      return fallbackAll(inputs);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
