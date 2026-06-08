// TaskDetail（MC-61）— タスクカードのドリルダウン詳細。
// ドロワー（md 以上は右スライド、モバイルは下からのボトムシート/フルスクリーン）で
//   (a) 概要・ステータス・担当・出典（既存 /api/tasks の Task データ）
//   (b) 紐づく workflow run のフェーズ進捗（MC-60 /api/workflows・/api/workflows/:runId）
//   (c) 紐づくエージェント会話（既存 Feed の該当スレッド = /api/agents/:id/feed を AgentFeed で再利用）
// を一望表示する。
//
// 紐付けロジック（MC-62 で精緻化済み）:
//   data/task-links.jsonl の明示ログ（/api/tasks/:taskId/links）を最優先で使う。
//   明示リンクがあれば、その runId / agentId のものだけを表示（誤マッチを構造的に排除）。
//   明示リンクが 1 件も無いタスクは、従来の素朴フォールバック
//   （タスク ID を runId/label に部分一致 → 無ければ全 run 候補）を維持する。
//
// デザイン制約: ハードコード hex 禁止（既存トークン/CSS 変数のみ）、UI chrome は SVG アイコンのみ、
//   文言は中立的な丁寧体、モバイル 390px で横溢れ 0。

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  Task,
  TaskStatus,
} from '../lib/types';
import {
  projectColor,
  projectLabel,
  taskStatusMeta,
  TASK_COLUMNS,
} from '../lib/meta';
import { absoluteTime, relativeTime } from '../lib/time';
import { Badge, StalledBadge, TaskStatusBadge } from './ui';
import { TaskTimeline } from './TaskTimeline';
import { CloseIcon, EditIcon } from './icons';

// (MC-167) 削除: Workflow 型定義は使用されなくなったため削除
// interface WorkflowNode / WorkflowPhase / WorkflowSummary / WorkflowDetail

// (MC-167) 削除: TaskLink 型定義は使用されなくなったため削除
// interface TaskLink / TaskLinkRun / TaskLinksResponse

// (MC-167) 削除: ワークフロー・デプロイ・会話関連の関数は使用されなくなったため削除
// function wfStatusMeta / tokensLabel / normalizeId / runMatchesTask

// (MC-167) 削除: StatusDotInline は ワークフロー表示用で使用されなくなったため削除

// (MC-167) 削除: WorkflowRunRow は ワークフロー一覧表示用で使用されなくなったため削除

// (MC-167) 削除: LinkedWorkflows は ワークフロー紐づけセクション用で使用されなくなったため削除

// (MC-167) 削除: LinkedConversation は エージェント会話セクション用で使用されなくなったため削除

// (MC-167) 削除: デプロイ状況関連関数は CI実行履歴でタスク単位でないため削除
// function deployRunMeta / workflowLabel / DeployRunRow / LinkedDeploys

function SectionHeading({ children }: { children: string }) {
  return (
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-faint">
      {children}
    </h3>
  );
}

// ── 編集（MC-71 edit スライス）─────────────────────────────
// source が logic/ ・ nishimaru/ ・ cxo/ で始まる台帳のみ Apollo から編集できる。
// kanban/today/private 等は .md 直接編集を促す（編集ボタンを出さない）。
const EDITABLE_SOURCE_PREFIXES = ['logic/', 'nishimaru/', 'cxo/'];

function isEditableSource(source: string): boolean {
  return EDITABLE_SOURCE_PREFIXES.some((p) => source.startsWith(p));
}

interface EditApiResponse {
  ok?: boolean;
  task?: Task;
  hash?: string;
  error?: string;
  code?: string;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as EditApiResponse;
    return body?.error ?? `${fallback}（HTTP ${res.status}）。`;
  } catch {
    return `${fallback}（HTTP ${res.status}）。`;
  }
}

/**
 * 「概要」セクションの編集フォーム。title/status/owner/priority を編集し、
 * GET /api/tasks/hash で baseHash を取得 → POST /api/tasks/edit で書き戻す。
 * 成功でローカル表示を更新し、親へ onChanged?() で一覧 refetch を促す。
 */
function OverviewEditForm({
  task,
  source,
  onSaved,
  onCancel,
}: {
  task: Task;
  source: string;
  onSaved: (updated: Task) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState<TaskStatus>(
    task.status === 'UNKNOWN' ? 'TODO' : task.status,
  );
  const [owner, setOwner] = useState(task.owner ?? '');
  const [priority, setPriority] = useState(task.priority ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 変更があったフィールドだけを patch に含める。
  const buildPatch = (): Record<string, string> => {
    const patch: Record<string, string> = {};
    if (title.trim() !== task.title) patch.title = title.trim();
    if (status !== task.status) patch.status = status;
    if (owner !== (task.owner ?? '')) patch.owner = owner;
    if (priority !== (task.priority ?? '')) patch.priority = priority;
    return patch;
  };

  const handleSave = async () => {
    if (saving) return;
    if (title.trim() === '') {
      setError('タイトルを入力してください。');
      return;
    }
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // 編集直前に baseHash を取得（楽観ロック）。
      const hashRes = await fetch(`/api/tasks/hash?source=${encodeURIComponent(source)}`);
      if (!hashRes.ok) {
        throw new Error(await readApiError(hashRes, 'ハッシュの取得に失敗しました'));
      }
      const { hash: baseHash } = (await hashRes.json()) as { hash: string };

      // MC-166: status だけが変更され、他フィールドは変わっていない場合は status-lock endpoint を使う。
      // これで 🔒[Keita] が付与され、git commit される。
      const statusOnly = Object.keys(patch).length === 1 && patch.status !== undefined;
      const endpoint = statusOnly ? '/api/tasks/status-lock' : '/api/tasks/edit';
      const body = statusOnly
        ? JSON.stringify({ source, id: task.id, status: patch.status, baseHash })
        : JSON.stringify({ source, id: task.id, patch, baseHash });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (res.status === 409) {
        setError('他の更新と競合しました。画面を再読み込みしてください。');
        return;
      }
      if (res.status === 422) {
        setError('この台帳では自動編集できませんでした。.md を直接編集してください。');
        return;
      }
      if (!res.ok) {
        setError(await readApiError(res, '保存に失敗しました'));
        return;
      }
      const data = (await res.json()) as EditApiResponse;
      // MC-166: status-lock endpoint 成功時は commitSha が返る＝commit されたので成功メッセージを表示。
      if ('commitSha' in data && data.commitSha) {
        setSuccess(`状態を保存しました 🔒（commit: ${data.commitSha}）`);
        // 3秒後に自動クローズ。
        setTimeout(() => onSaved(data.task ?? ({ ...task, ...patch } as Task)), 3000);
      } else {
        if (data.task) onSaved(data.task);
        else onSaved({ ...task, ...patch } as Task);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none';

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[11px] text-text-muted" htmlFor="task-edit-title">
          タイトル
        </label>
        <input
          id="task-edit-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={500}
          className={fieldClass}
          placeholder="タイトルを入力してください"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-text-muted" htmlFor="task-edit-status">
          ステータス
        </label>
        <select
          id="task-edit-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskStatus)}
          className={fieldClass}
        >
          {TASK_COLUMNS.map((s) => (
            <option key={s} value={s}>
              {taskStatusMeta(s).label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-text-muted" htmlFor="task-edit-owner">
          担当
        </label>
        <input
          id="task-edit-owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          maxLength={200}
          className={fieldClass}
          placeholder="担当者を入力してください"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-text-muted" htmlFor="task-edit-priority">
          優先度
        </label>
        <input
          id="task-edit-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          maxLength={50}
          className={fieldClass}
          placeholder="優先度を入力してください"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-border px-3 py-2 text-[12px]"
          style={{ color: 'var(--mc-stalled)' }}
        >
          {error}
        </p>
      )}

      {success && (
        <p
          role="status"
          className="rounded-lg border border-border px-3 py-2 text-[12px]"
          style={{ color: 'var(--mc-done)' }}
        >
          {success}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg px-3 py-2 text-[13px] text-text-muted hover:bg-surface-2 disabled:opacity-50"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-bg hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存する'}
        </button>
      </div>
    </div>
  );
}

/** タスク詳細ドロワー本体。task が null の間は何も描画しない。 */
export function TaskDetail({
  task,
  onClose,
  onChanged,
}: {
  task: Task | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  // Esc クローズ + 背面スクロールロック。
  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [task, onClose]);

  if (!task) return null;
  return <TaskDetailBody task={task} onClose={onClose} onChanged={onChanged} />;
}

/**
 * ドロワー本体（task が確定した状態で描画）。
 * 明示リンク（/api/tasks/:taskId/links）をここで一度だけ取得し、
 * 紐づくワークフロー / 会話の両セクションへ渡す。
 */
function TaskDetailBody({
  task,
  onClose,
  onChanged,
}: {
  task: Task;
  onClose: () => void;
  onChanged?: () => void;
}) {
  // (MC-167) 削除: links を取得していた useLiveResource を削除
  // const { data: links } = useLiveResource<TaskLinksResponse>(
  //   `/api/tasks/${encodeURIComponent(task.id)}/links`,
  //   tick,
  // );

  // ローカル上書き表示（保存成功で即時反映。親 refetch が届くまでのギャップを埋める）。
  const [localTask, setLocalTask] = useState<Task>(task);
  const [editing, setEditing] = useState(false);
  // 詳細本文（detail）の遅延取得状態（MC-206）。一覧 API は軽量化のため detail を返さないので、
  // カードを開いた時に単一タスク API から detail を取りに行く。未取得時は詳細メモを出さない。
  const [detailLoading, setDetailLoading] = useState(false);
  // 親から別タスクが渡し直されたらローカル状態をリセット。
  useEffect(() => {
    setLocalTask(task);
    setEditing(false);
  }, [task]);

  // MC-206: 開いたタスクの detail を単一タスク API から取得して merge する。
  // 一覧（軽量版）には detail が無いため、ここで /api/tasks/:id/detail を 1 回だけ叩く。
  // 取得済み（detail が既にある）ならスキップ。失敗時はクラッシュさせず詳細メモ非表示のまま。
  useEffect(() => {
    if (task.detail !== undefined) return; // 既に detail を持つ（?detail=1 経由等）なら不要
    let cancelled = false;
    setDetailLoading(true);
    const params = new URLSearchParams();
    if (task.source) params.set('source', task.source);
    const qs = params.toString();
    fetch(`/api/tasks/${encodeURIComponent(task.id)}/detail${qs ? `?${qs}` : ''}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: { task?: Task }) => {
        if (cancelled || !json.task) return;
        // detail（と取れれば付帯フィールド）だけを上書き merge。編集中のローカル状態は壊さない。
        setLocalTask((prev) => ({ ...prev, detail: json.task!.detail }));
      })
      .catch(() => {
        /* 失敗時は詳細メモ非表示のまま（安全側） */
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [task]);

  const view = localTask;
  const editable = isEditableSource(view.source);
  const statusMeta = taskStatusMeta(view.status);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`タスク詳細: ${view.title}`}
    >
      {/* 背面オーバーレイ */}
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      {/* ドロワー本体: モバイルは全幅・上から少し空けたフルハイト、md 以上は右スライドのパネル */}
      <div
        className="relative flex h-full w-full max-w-full flex-col border-l border-border bg-bg shadow-xl md:w-[34rem]"
        style={{ borderTop: `3px solid ${projectColor(task.project)}` }}
      >
        {/* ヘッダ */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-text-faint">{view.id}</span>
              {view.stalled && <StalledBadge />}
            </div>
            <h2 className="mt-1 select-text text-[15px] font-bold leading-snug text-text">{view.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="shrink-0 rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* (a) 概要 */}
          <section className="mb-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <SectionHeading>概要</SectionHeading>
              {editable && !editing && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="概要を編集する"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  <EditIcon width={14} height={14} />
                  編集
                </button>
              )}
            </div>

            {editing ? (
              <OverviewEditForm
                task={view}
                source={view.source}
                onCancel={() => setEditing(false)}
                onSaved={(updated) => {
                  setLocalTask((prev) => ({ ...prev, ...updated }));
                  setEditing(false);
                  onChanged?.();
                }}
              />
            ) : (
              <>
                <dl className="space-y-2 text-[13px]">
                  <div className="flex items-center gap-2">
                    <dt className="w-20 shrink-0 text-text-faint">ステータス</dt>
                    <dd>
                      <TaskStatusBadge status={view.status} />
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="w-20 shrink-0 text-text-faint">プロジェクト</dt>
                    <dd className="inline-flex items-center gap-1.5 text-text">
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        style={{ background: projectColor(view.project) }}
                        aria-hidden
                      />
                      {projectLabel(view.project)}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="w-20 shrink-0 text-text-faint">担当</dt>
                    <dd className="select-text text-text">{view.owner || '未割り当て'}</dd>
                  </div>
                  {view.priority && (
                    <div className="flex items-center gap-2">
                      <dt className="w-20 shrink-0 text-text-faint">優先度</dt>
                      <dd>
                        <Badge>{view.priority}</Badge>
                      </dd>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <dt className="w-20 shrink-0 text-text-faint">出典</dt>
                    <dd className="select-text break-all text-text-muted">{view.source}</dd>
                  </div>
                  {view.updated && (
                    <div className="flex items-center gap-2">
                      <dt className="w-20 shrink-0 text-text-faint">更新</dt>
                      <dd className="text-text-muted" title={absoluteTime(view.updated)}>
                        {relativeTime(view.updated)}
                      </dd>
                    </div>
                  )}
                </dl>
                {/* ステータスの語ラベル（色のみ依存にしない） */}
                <p className="mt-2 text-[11px]" style={{ color: statusMeta.color }}>
                  現在の状態: {statusMeta.label}
                </p>
                {!editable && (
                  <p className="mt-2 text-[11px] text-text-faint">
                    この台帳の項目は Apollo から編集できません（.md を直接編集してください）。
                  </p>
                )}
              </>
            )}
          </section>

          {/* (MC-170) ブロッカー・依存セクション。
           * 台帳の「依存」由来（MC-169 collector がパース）。データが取れた場合のみ表示し、
           * 無ければ「依存なし」を中立表示する。概要の直後に置いて状況を一目で把握できるようにする。
           */}
          <section className="mb-5">
            <SectionHeading>ブロッカー・依存</SectionHeading>
            {view.blockedBy?.length || view.dependsOn?.length ? (
              <div className="space-y-3">
                {view.blockedBy?.length ? (
                  <div>
                    <p className="mb-1 text-[11px] text-text-muted">ブロックしているタスク</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {view.blockedBy.map((id) => (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => {
                              // ドリルダウン：タスク詳細を再度開く。Task リスト → クリック → 該当タスク詳細ロード。
                              // 実装: onTaskIdSelected?() で親へリクエスト、又は /api/tasks/:id で直接 fetch。
                              // 暫定: console log で確認。
                              console.log(`ブロッカーをクリック: ${id}`);
                            }}
                            className="inline-block rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-text-muted hover:bg-surface-hover transition-colors"
                          >
                            {id}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {view.dependsOn?.length ? (
                  <div>
                    <p className="mb-1 text-[11px] text-text-muted">依存しているタスク</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {view.dependsOn.map((id) => (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => {
                              console.log(`依存タスクをクリック: ${id}`);
                            }}
                            className="inline-block rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-text-muted hover:bg-surface-hover transition-colors"
                          >
                            {id}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[12px] text-text-faint">依存はありません。</p>
            )}
          </section>

          {/* (a-2) 詳細メモ（MC-83 / MC-206）— 台帳の「詳細」/受け入れ条件/サブタスク等。
              一覧 API は軽量化で detail を返さないため、カードを開いた時に単一タスク API から遅延取得する。
              取得中はローディング、本文があれば表示、無ければセクション自体を出さない。 */}
          {view.detail ? (
            <section className="mb-5">
              <SectionHeading>詳細メモ</SectionHeading>
              <div className="rounded-lg border border-border bg-surface px-3 py-3">
                <p className="select-text whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-muted">
                  {view.detail}
                </p>
              </div>
            </section>
          ) : detailLoading ? (
            <section className="mb-5">
              <SectionHeading>詳細メモ</SectionHeading>
              <div className="rounded-lg border border-border bg-surface px-3 py-3">
                <p className="text-[12px] text-text-faint">詳細を読み込み中…</p>
              </div>
            </section>
          ) : null}

          {/* (MC-167) 削除: 紐づくワークフロー（タスクに紐づけられず無関係 wf_xxx をトークン数つき羅列＝ノイズ） */}
          {/* REMOVED: LinkedWorkflows セクション */}

          {/* (MC-167) 削除: デプロイ状況（CI実行履歴でタスク単位でない） */}
          {/* REMOVED: LinkedDeploys セクション */}

          {/* (MC-167) 削除: 紐づくエージェント会話（特定不可で直近会話を表示＝無関係） */}
          {/* REMOVED: LinkedConversation セクション */}

          {/* (d) 活動タイムライン（MC-163） */}
          <section>
            <SectionHeading>アクティビティ</SectionHeading>
            <TaskTimeline taskId={task.id} />
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
