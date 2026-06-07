// SortableNav — ナビのドラッグ並べ替え用プリミティブ（MC-158）。
//
// dnd-kit の handle 方式でラップする。各ナビ項目は NavLink でクリック＝遷移するため、
// ドラッグは専用のグリップハンドル（GripIcon）を掴んだ時だけ発火させる。handle 以外を
// クリックしたら通常どおり遷移する（listeners をハンドルにだけ付ける）。
//
// タッチ対応: PointerSensor（マウス/ペン/指）に加え、モバイルでの誤ドラッグ防止に
// activationConstraint を設定。PointerSensor は移動距離しきい値、TouchSensor は
// 長押し遅延でドラッグ開始する。KeyboardSensor も付けてアクセシビリティを担保。
//
// 見た目: ドラッグ中は半透明＋少し持ち上げる（dnd-kit の transform/transition を利用）。

import type { ReactNode, CSSProperties } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripIcon } from './icons';

interface HasId {
  /** 一意キー（ナビ項目の `to`）。 */
  to: string;
}

/** ドラッグハンドルへ渡す props（useSortable の listeners/attributes）。 */
export interface DragHandleProps {
  /** グリップボタンに spread する。これを付けた要素を掴んだ時だけドラッグが発火する。 */
  handleProps: Record<string, unknown>;
  /** ドラッグ中フラグ（見た目調整用）。 */
  isDragging: boolean;
}

/**
 * 1 項目をソート可能にするラッパー。children は render-prop で、ハンドル props を受け取る。
 * 行全体の transform/transition/opacity はここで適用し、children には中身だけ描かせる。
 */
function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (h: DragHandleProps) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({
        handleProps: { ...attributes, ...listeners },
        isDragging,
      })}
    </div>
  );
}

/** グリップ（ドラッグハンドル）ボタン。handleProps を掴んだ時だけドラッグが発火する。 */
export function DragHandle({
  handleProps,
  className,
}: {
  handleProps: Record<string, unknown>;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="ドラッグして並べ替え"
      // touch-none: ブラウザのタッチスクロールと競合させない（dnd-kit 推奨）。
      // cursor-grab: 掴める見た目。
      className={`touch-none cursor-grab text-text-muted hover:text-text active:cursor-grabbing ${className ?? ''}`}
      // ハンドルのクリックで NavLink 遷移しないよう、念のためクリックを止める。
      onClick={(e) => e.preventDefault()}
      {...handleProps}
    >
      <GripIcon width={16} height={16} />
    </button>
  );
}

/**
 * ドラッグ並べ替えコンテナ。items を並べ替え可能にし、確定で onReorder(next) を呼ぶ。
 * children は render-prop で各項目を描く（item ＋ ハンドル props）。
 */
export function SortableNav<T extends HasId>({
  items,
  onReorder,
  direction = 'vertical',
  children,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  /** 並びの向き（vertical=サイドバー / horizontal=サブタブ）。 */
  direction?: 'vertical' | 'horizontal';
  children: (item: T, handle: DragHandleProps) => ReactNode;
}) {
  const sensors = useSensors(
    // マウス/ペン/指: 6px 動かしてからドラッグ開始（タップ・クリックを誤検知しない）。
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // タッチ: 長押し 200ms＋移動許容 8px でドラッグ開始（モバイルの誤ドラッグ防止）。
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.to === active.id);
    const newIndex = items.findIndex((i) => i.to === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  };

  const strategy =
    direction === 'horizontal' ? horizontalListSortingStrategy : verticalListSortingStrategy;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((i) => i.to)} strategy={strategy}>
        {items.map((item) => (
          <SortableItem key={item.to} id={item.to}>
            {(handle) => children(item, handle)}
          </SortableItem>
        ))}
      </SortableContext>
    </DndContext>
  );
}
