// 受信箱 FAB + ボトムシート（md+ は中央モーダル）。
// タスクを text + 画像付きで POST /api/inbox（multipart/form-data）に投入する。
// MC-77: タスク/指示の区別は廃止。投入は全て「タスク」として送り、サーバ側で
// 即タスクボード（TASK_TRACKER）に反映される。文言は中立的な丁寧体。
import { useEffect, useRef, useState } from 'react';
import type { RosterEntry } from '../lib/types';
import { PlusIcon, CloseIcon, ImageFileIcon } from './icons';

type ProjectChoice = 'logic' | 'cxo' | 'en-chakai' | '';

const PROJECT_OPTIONS: { value: ProjectChoice; label: string }[] = [
  { value: '', label: '指定なし' },
  { value: 'logic', label: 'logic' },
  { value: 'cxo', label: 'cxo' },
  { value: 'en-chakai', label: 'en-chakai' },
];

// MC-86: 指令を委譲できない（指令の担当にならない）エージェント。
// 林（main assistant）と apollo（インフラ番人）は roster には出るが委譲先ではないため、
// 担当セレクタの選択肢からは除外する。サーバ側 INBOX_AGENTS ホワイトリストと整合させる。
const NON_DELEGATABLE_AGENTS = new Set(['hayashi-rin', 'apollo']);

const MAX_IMAGES = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB / 枚

interface PickedImage {
  id: string;
  file: File;
  url: string; // object URL（プレビュー用、cleanup 必須）
}

export default function AddTaskFab() {
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState<ProjectChoice>('');
  const [agent, setAgent] = useState('');
  const [text, setText] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // MC-86: 担当エージェント候補（roster から取得・委譲可能な subagent のみ）。
  const [agents, setAgents] = useState<RosterEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // シートを開いた時に roster を読み、担当エージェントの選択肢を用意する。
  // 失敗時は黙って「指定なし」のみにフォールバックする（投入自体は agent 無しで通る）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/roster');
        if (!res.ok) return;
        const body = (await res.json()) as { roster?: RosterEntry[] };
        if (cancelled || !Array.isArray(body.roster)) return;
        setAgents(body.roster.filter((r) => !NON_DELEGATABLE_AGENTS.has(r.name)));
      } catch {
        // roster 取得失敗は無視（担当未指定で投入できる）。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // object URL の cleanup（アンマウント時・画像差し替え時に漏れないよう）。
  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // open 中は背景スクロールを止める。
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const resetForm = () => {
    images.forEach((img) => URL.revokeObjectURL(img.url));
    setProject('');
    setAgent('');
    setText('');
    setImages([]);
    setError(null);
  };

  const closeSheet = () => {
    setOpen(false);
    setError(null);
  };

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    setError(null);
    const accepted: PickedImage[] = [];
    let rejected = false;
    for (const file of incoming) {
      if (images.length + accepted.length >= MAX_IMAGES) {
        rejected = true;
        break;
      }
      if (!file.type.startsWith('image/')) {
        rejected = true;
        continue;
      }
      if (file.size > MAX_BYTES) {
        rejected = true;
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        url: URL.createObjectURL(file),
      });
    }
    if (accepted.length > 0) setImages((prev) => [...prev, ...accepted]);
    if (rejected) {
      setError(`画像は最大 ${MAX_IMAGES} 枚・各 10MB までです。一部の画像は追加されませんでした。`);
    }
    // 同じファイルを連続選択できるよう input をクリア。
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    addFiles(Array.from(fileList));
  };

  // シートが開いている間、クリップボード画像の貼付（Ctrl+V）を受け付ける。
  // textarea にフォーカスがあっても document レベルで拾えるよう、window に購読する。
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            // スクショ等は名前が空のことがあるため拡張子付きの名前を補う。
            const ext = file.type.split('/')[1] || 'png';
            const named =
              file.name && file.name.trim() !== ''
                ? file
                : new File([file], `pasted-${Date.now()}.${ext}`, { type: file.type });
            files.push(named);
          }
        }
      }
      if (files.length > 0) {
        // 画像を貼り付けたらテキスト挿入は抑止する。
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // addFiles は images の現在値を参照するため open のたびに最新クロージャで再購読する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, images]);

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((i) => i.id !== id);
    });
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!text.trim()) {
      setError('内容を入力してください。');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      // MC-77: kind は廃止。サーバは送られても task に正規化するが、ここでは送らない。
      fd.append('text', text.trim());
      fd.append('project', project);
      // MC-86: 担当エージェント（任意）。未指定なら送らない＝自動割当。
      if (agent) fd.append('agent', agent);
      images.forEach((img) => fd.append('images', img.file, img.file.name));
      // Content-Type は指定しない（FormData が boundary 付きで自動設定）。
      const res = await fetch('/api/inbox', { method: 'POST', body: fd });
      if (res.status !== 201) {
        let reason = `送信に失敗しました（HTTP ${res.status}）。`;
        try {
          const body = (await res.json()) as { error?: string; message?: string };
          if (body?.error || body?.message) reason = body.error ?? body.message ?? reason;
        } catch {
          // JSON でない場合は既定メッセージのまま。
        }
        setError(reason);
        return;
      }
      resetForm();
      setOpen(false);
      setSuccess('タスクを追加しました。');
      window.setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? `送信に失敗しました。${e.message}` : '送信に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* FAB（全画面常設。BottomNav に被らない位置）。 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="受信箱に追加"
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex h-14 w-14 items-center justify-center rounded-full bg-accent text-bg shadow-lg transition-colors hover:bg-accent-strong md:bottom-6"
        style={{ zIndex: 45 }}
      >
        <PlusIcon width={26} height={26} />
      </button>

      {/* 成功トースト。 */}
      {success && (
        <div
          role="status"
          className="fixed left-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] -translate-x-1/2 rounded-lg border border-active/40 bg-active-bg px-4 py-2 text-sm font-medium text-active shadow-lg md:bottom-6"
          style={{ zIndex: 60 }}
        >
          {success}
        </div>
      )}

      {/* シート / モーダル。 */}
      {open && (
        <div
          className="fixed inset-0 flex items-end justify-center md:items-center"
          style={{ zIndex: 55 }}
          role="dialog"
          aria-modal="true"
          aria-label="受信箱に追加"
        >
          <button
            type="button"
            aria-label="閉じる"
            className="absolute inset-0 bg-black/50"
            onClick={closeSheet}
          />
          <div className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl md:max-h-[85dvh] md:w-[28rem] md:rounded-2xl md:pb-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-text">受信箱に追加</h2>
              <button
                type="button"
                onClick={closeSheet}
                aria-label="閉じる"
                className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <CloseIcon width={18} height={18} />
              </button>
            </div>

            {/* project セレクト */}
            <div className="mb-3">
              <label className="mb-1 block text-xs text-text-muted" htmlFor="inbox-project">
                プロジェクト
              </label>
              <select
                id="inbox-project"
                value={project}
                onChange={(e) => setProject(e.target.value as ProjectChoice)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              >
                {PROJECT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* MC-86: 担当エージェント（任意・未指定なら自動割当） */}
            <div className="mb-3">
              <label className="mb-1 block text-xs text-text-muted" htmlFor="inbox-agent">
                担当エージェント
              </label>
              <select
                id="inbox-agent"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              >
                <option value="">自動割当（指定なし）</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.role ? `${a.name}（${a.role}）` : a.name}
                    {a.liveStatus === 'active' ? ' ・稼働中' : ' ・待機中'}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-text-faint">
                指定すると、その担当としてタスク化され、自律処理時に該当エージェントへ委譲されます。
              </p>
            </div>

            {/* text */}
            <div className="mb-3">
              <label className="mb-1 block text-xs text-text-muted" htmlFor="inbox-text">
                内容
              </label>
              <textarea
                id="inbox-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder="タスクの内容を入力してください"
                className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
              />
            </div>

            {/* 画像 */}
            <div className="mb-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-text-muted">画像（任意・最大 {MAX_IMAGES} 枚）</span>
                <span className="text-[11px] text-text-faint">{images.length}/{MAX_IMAGES}</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handleFiles(e.target.files)}
                className="hidden"
                id="inbox-images"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={images.length >= MAX_IMAGES}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-2 px-3 py-3 text-xs text-text-muted hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ImageFileIcon width={16} height={16} />
                画像を選択
              </button>
              <p className="mt-1.5 text-[11px] text-text-faint">
                Ctrl+V（Mac は ⌘+V）で画像を貼り付けられます。
              </p>
              {images.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {images.map((img) => (
                    <div
                      key={img.id}
                      className="relative aspect-square overflow-hidden rounded-md border border-border bg-surface-2"
                    >
                      <img
                        src={img.url}
                        alt={img.file.name}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(img.id)}
                        aria-label={`${img.file.name} を削除`}
                        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-text hover:bg-black/80"
                      >
                        <CloseIcon width={12} height={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* エラー */}
            {error && (
              <div
                role="alert"
                className="mb-3 rounded-lg border border-stalled/40 bg-stalled-bg/60 px-3 py-2 text-xs"
                style={{ color: 'var(--mc-stalled)' }}
              >
                {error}
              </div>
            )}

            {/* 送信 */}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeSheet}
                className="rounded-lg px-4 py-2 text-sm text-text-muted hover:bg-surface-2"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !text.trim()}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-bg hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '送信中…' : '追加する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
