// Vault フォルダツリー（折りたたみ・ファイルクリックで開く）。
import { useState } from 'react';
import type { VaultTreeNode } from '../lib/types';
import {
  FolderIcon,
  FolderOpenIcon,
  FileIcon,
  ImageFileIcon,
  ChevronRightIcon,
} from './icons';

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

function FileNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: VaultTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: VaultTreeNode) => void;
}) {
  const isImage = node.ext ? IMG_EXTS.has(node.ext) : false;
  const isMd = node.ext === '.md';
  const selected = selectedPath === node.path;
  return (
    <button
      type="button"
      onClick={() => onSelect(node)}
      title={node.path}
      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[13px] transition-colors ${
        selected
          ? 'bg-surface-3 font-medium text-text'
          : 'text-text-muted hover:bg-surface-2 hover:text-text'
      }`}
      style={{ paddingLeft: `${depth * 14 + 22}px` }}
      aria-current={selected ? 'true' : undefined}
    >
      <span className="shrink-0 text-text-faint" aria-hidden>
        {isImage ? (
          <ImageFileIcon width={14} height={14} />
        ) : (
          <FileIcon width={14} height={14} />
        )}
      </span>
      <span className={`truncate ${isMd ? '' : 'text-text-faint'}`}>
        {isMd ? node.name.replace(/\.md$/, '') : node.name}
      </span>
    </button>
  );
}

function DirNode({
  node,
  depth,
  selectedPath,
  onSelect,
  defaultOpen,
}: {
  node: VaultTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: VaultTreeNode) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        aria-expanded={open}
      >
        <span
          className="shrink-0 text-text-faint transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          aria-hidden
        >
          <ChevronRightIcon width={14} height={14} />
        </span>
        <span className="shrink-0 text-text-faint" aria-hidden>
          {open ? <FolderOpenIcon width={15} height={15} /> : <FolderIcon width={15} height={15} />}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {open && node.children && (
        <div>
          {node.children.map((child) =>
            child.type === 'dir' ? (
              <DirNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                defaultOpen={false}
              />
            ) : (
              <FileNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export default function VaultTree({
  root,
  selectedPath,
  onSelect,
}: {
  root: VaultTreeNode;
  selectedPath: string | null;
  onSelect: (node: VaultTreeNode) => void;
}) {
  const children = root.children ?? [];
  return (
    <div className="py-1">
      {children.map((child) =>
        child.type === 'dir' ? (
          <DirNode
            key={child.path}
            node={child}
            depth={0}
            selectedPath={selectedPath}
            onSelect={onSelect}
            defaultOpen={false}
          />
        ) : (
          <FileNode
            key={child.path}
            node={child}
            depth={0}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ),
      )}
    </div>
  );
}
