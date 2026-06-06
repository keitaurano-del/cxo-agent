// アップロード状態をグローバルに管理する Context。
// コンポーネントのアンマウントと無関係に XHR が継続するため、
// ページ遷移中でもアップロードが続いて完了を検知できる。
// 100MB 超のフォルダはファイル単位で 95MB 以下のバッチに分割して順次送信する。
// 50MB 超のファイルは /api/deliverables/upload-chunk で 20MB チャンクに分割して送信する。
import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';

// cloudflared 無料トンネルのリクエストボディ上限が約 100MB のため、安全側で 50MB に設定。
// サーバ側の multer ファイル数上限（DELIVERABLE_UPLOAD_MAX_FILES=500）に対してもマージンを持たせる。
const BATCH_LIMIT_BYTES = 50 * 1024 * 1024;
const BATCH_LIMIT_COUNT = 100; // 1バッチ最大ファイル数

// 50MB 超のファイルはチャンク送信する（cloudflared 制限対策）。
const CHUNK_THRESHOLD = 50 * 1024 * 1024; // 50MB
const CHUNK_SIZE = 20 * 1024 * 1024;      // 20MB（cloudflared 限界の 1/5）

type Entry = { file: File; relpath: string };

/** サイズ・件数の両方が上限以下になるようファイル単位でバッチに分割する。 */
function splitBatches(entries: Entry[]): Entry[][] {
  const batches: Entry[][] = [];
  let batch: Entry[] = [];
  let batchSize = 0;
  for (const e of entries) {
    const s = e.file.size;
    const overSize = batch.length > 0 && batchSize + s > BATCH_LIMIT_BYTES;
    const overCount = batch.length >= BATCH_LIMIT_COUNT;
    if (overSize || overCount) {
      batches.push(batch);
      batch = [e];
      batchSize = s;
    } else {
      batch.push(e);
      batchSize += s;
    }
    // 1ファイル単体でもサイズ上限を超える場合はそのまま単独バッチにして次へ進む
    if (batch.length === 1 && batchSize > BATCH_LIMIT_BYTES) {
      batches.push(batch);
      batch = [];
      batchSize = 0;
    }
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/**
 * 1チャンクを XHR で送信し、完了 Promise を返す。
 * 最終チャンクなら 201、中間チャンクなら 200 が期待値。
 */
function sendOneChunk(
  fd: FormData,
  chunkIndex: number,
  totalChunks: number,
  totalFileBytes: number,
  sentBefore: number,
  onProgress: (loaded: number, total: number) => void,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', '/api/deliverables/upload-chunk');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        // このチャンク内の進捗をファイル全体の進捗に換算。
        const chunkStart = chunkIndex * CHUNK_SIZE;
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalFileBytes);
        const chunkBytes = chunkEnd - chunkStart;
        const loaded = sentBefore + Math.round((ev.loaded / ev.total) * chunkBytes);
        onProgress(loaded, totalFileBytes);
      }
    };
    xhr.onload = () => {
      xhrRef.current = null;
      const isLast = chunkIndex === totalChunks - 1;
      const expectedStatus = isLast ? 201 : 200;
      if (xhr.status === expectedStatus || (isLast && xhr.status === 200)) {
        resolve();
      } else {
        let msg = `チャンクアップロードに失敗しました（HTTP ${xhr.status}、チャンク ${chunkIndex + 1}/${totalChunks}）。`;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          if (body.error) msg = body.error;
        } catch { /* ignore */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      reject(new Error(`ネットワークエラーでチャンクアップロードに失敗しました（チャンク ${chunkIndex + 1}/${totalChunks}）。`));
    };
    xhr.send(fd);
  });
}

/**
 * 50MB 超のファイルを CHUNK_SIZE ごとに分割してチャンク送信する。
 * 完了したら 1 を返す（ファイル 1 件分）。
 */
async function sendChunked(
  entry: Entry,
  onProgress: (loaded: number, total: number) => void,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>,
): Promise<number> {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const totalChunks = Math.ceil(entry.file.size / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, entry.file.size);
    const chunk = entry.file.slice(start, end);

    const fd = new FormData();
    fd.append('chunk', chunk, 'chunk');
    fd.append('sessionId', sessionId);
    fd.append('relpath', entry.relpath);
    fd.append('chunkIndex', String(i));
    fd.append('totalChunks', String(totalChunks));

    await sendOneChunk(fd, i, totalChunks, entry.file.size, start, onProgress, xhrRef);
  }
  return 1; // ファイル 1 件完了
}

/** 1バッチを XHR で送信し、進捗コールバックを受け取る Promise を返す。 */
function sendBatch(
  batch: Entry[],
  onProgress: (loaded: number, total: number) => void,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    batch.forEach((e) => fd.append('files', e.file, e.relpath));
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', '/api/deliverables/upload');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status === 201) {
        let count = batch.length;
        try {
          const body = JSON.parse(xhr.responseText) as { files?: unknown[] };
          count = body.files?.length ?? batch.length;
        } catch { /* ignore */ }
        resolve(count);
      } else {
        let msg = `アップロードに失敗しました（HTTP ${xhr.status}）。`;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          if (body.error) msg = body.error;
        } catch { /* ignore */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      reject(new Error('ネットワークエラーでアップロードに失敗しました。'));
    };
    xhr.send(fd);
  });
}

interface UploadState {
  uploading: boolean;
  progress: number; // 0-100（全バッチ通算）
  batchInfo: string | null; // 「バッチ 2/3」など複数バッチ時のみ表示
  message: string | null;
  error: string | null;
  fileName: string | null; // 「PM人材育成支援 (3件)」など
}

interface UploadContextValue extends UploadState {
  upload: (entries: Entry[]) => void;
  dismiss: () => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UploadState>({
    uploading: false,
    progress: 0,
    batchInfo: null,
    message: null,
    error: null,
    fileName: null,
  });
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const upload = useCallback(
    (entries: Entry[]) => {
      if (entries.length === 0 || state.uploading) return;

      const topFolder = entries[0].relpath.split('/')[0];
      const hasFolder = entries.some((e) => e.relpath.includes('/'));
      const label = hasFolder ? `${topFolder} (${entries.length}件)` : `${entries.length}件`;
      const totalBytes = entries.reduce((s, e) => s + e.file.size, 0);

      // 50MB 超はチャンク送信、それ以下は従来バッチ送信。
      const normalEntries = entries.filter((e) => e.file.size <= CHUNK_THRESHOLD);
      const largeEntries = entries.filter((e) => e.file.size > CHUNK_THRESHOLD);
      const batches = splitBatches(normalEntries);
      const totalItems = batches.length + largeEntries.length;

      setState({ uploading: true, progress: 0, batchInfo: null, message: null, error: null, fileName: label });

      // 通常バッチ + 大容量チャンクを順次送信
      (async () => {
        let sentBytes = 0;
        let totalCount = 0;
        let itemIndex = 0;

        // 通常バッチ処理
        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          const batchBytes = batch.reduce((s, e) => s + e.file.size, 0);
          itemIndex++;

          // バッチ情報を更新（複数アイテムのときのみ表示）
          if (totalItems > 1) {
            setState((s) => ({ ...s, batchInfo: `バッチ ${itemIndex}/${totalItems}` }));
          }

          try {
            const count = await sendBatch(
              batch,
              (loaded) => {
                const overall = totalBytes > 0
                  ? Math.round(((sentBytes + loaded) / totalBytes) * 100)
                  : 0;
                setState((s) => ({ ...s, progress: overall }));
              },
              xhrRef,
            );
            sentBytes += batchBytes;
            totalCount += count;
            window.dispatchEvent(new CustomEvent('deliverables:uploaded'));
          } catch (err) {
            setState((s) => ({
              ...s,
              uploading: false,
              error: err instanceof Error ? err.message : String(err),
            }));
            return;
          }
        }

        // 大容量チャンク処理
        for (const entry of largeEntries) {
          itemIndex++;

          // バッチ情報を更新
          if (totalItems > 1) {
            setState((s) => ({ ...s, batchInfo: `ファイル ${itemIndex}/${totalItems}（チャンク転送中）` }));
          } else {
            setState((s) => ({ ...s, batchInfo: 'チャンク転送中' }));
          }

          try {
            const count = await sendChunked(
              entry,
              (loaded) => {
                const overall = totalBytes > 0
                  ? Math.round(((sentBytes + loaded) / totalBytes) * 100)
                  : 0;
                setState((s) => ({ ...s, progress: overall }));
              },
              xhrRef,
            );
            sentBytes += entry.file.size;
            totalCount += count;
            window.dispatchEvent(new CustomEvent('deliverables:uploaded'));
          } catch (err) {
            setState((s) => ({
              ...s,
              uploading: false,
              error: err instanceof Error ? err.message : String(err),
            }));
            return;
          }
        }

        setState((s) => ({
          ...s,
          uploading: false,
          progress: 100,
          batchInfo: null,
          message: `${totalCount}件をアップロードしました。`,
        }));
      })();
    },
    [state.uploading],
  );

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, message: null, error: null }));
  }, []);

  // アップロード中にリロード・タブ閉じを試みたときブラウザの離脱確認ダイアログを表示
  useEffect(() => {
    if (!state.uploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.uploading]);

  return (
    <UploadContext.Provider value={{ ...state, upload, dismiss }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within UploadProvider');
  return ctx;
}
