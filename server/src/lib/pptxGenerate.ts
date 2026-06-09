// pptxGenerate — スライドテンプレート（様式）から「空のたたき台 pptx」を生成する（MC-224 Phase2②）。
//
// pptxgenjs で 3 枚のスライドを組む:
//   1. 表紙: タイトル（opts.title || template.name）＋ サブ（template.whenToUse）。
//   2. 本文: メッセージライン用の空枠（messageLineExample をグレーのガイド表示）＋
//            placeholders を各ラベル付きの空ボックスとして配置。type で見せ方を変える。
//            layout は speaker notes に入れる。
//   3. チェックリスト: tips を箇条書き。
//
// 配色は淡色・原色回避（コンサルスライド作成ガイドの原則に沿う）。
// 生成物はバイナリ（nodebuffer）。先頭は zip シグネチャ（PK\x03\x04）。

import PptxGenJSImport from 'pptxgenjs';
import type { SlideTemplate, SlideTemplatePlaceholder } from './slideTemplates.js';

// pptxgenjs の default export は実行環境（tsc の esModuleInterop / tsx の ESM 解決）で
// 「コンストラクタ関数」だったり「{ default: コンストラクタ }」だったりするため、両対応で解決する。
const PptxGenJS = ((PptxGenJSImport as unknown as { default?: unknown }).default ??
  PptxGenJSImport) as typeof PptxGenJSImport;

// 淡色パレット（原色回避）。HEX は # 無しで指定する。
const COLOR = {
  ink: '33373D', // 本文の濃いグレー
  muted: '8A9099', // ガイド/補足のグレー
  guide: 'AAB0B8', // プレースホルダ内のガイド文（薄め）
  line: 'D6DBE0', // 枠線
  band: 'EEF1F4', // 薄い面（ボックス背景）
  accent: '6B8FB5', // 淡いブルー（アクセント）
};

const SLIDE_W = 10; // pptxgenjs LAYOUT_WIDE は 13.33in だが、既定 10x5.625 を使う。
const MARGIN = 0.5;

/** placeholder.type に応じた「枠内に出すガイド見出し」。 */
function zoneLabel(type: string): string | null {
  switch (type) {
    case 'chart':
      return 'グラフ領域';
    case 'image':
      return '画像領域';
    default:
      return null;
  }
}

/** ガイド文（hint）を枠内に薄く出すための合成テキスト。 */
function guideText(ph: SlideTemplatePlaceholder): string {
  const zone = zoneLabel(ph.type);
  const base = zone ? `［${zone}］` : '';
  if (ph.hint && base) return `${base}\n${ph.hint}`;
  if (ph.hint) return ph.hint;
  if (base) return base;
  return 'ここに記入';
}

/**
 * テンプレから空の pptx を生成して Buffer で返す。
 */
export async function generatePptxFromTemplate(
  template: SlideTemplate,
  opts?: { title?: string },
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'CXO', width: SLIDE_W, height: 5.625 });
  pptx.layout = 'CXO';

  const title = (opts?.title && opts.title.trim()) || template.name;
  const placeholders = Array.isArray(template.placeholders) ? template.placeholders : [];

  // ── スライド1: 表紙 ─────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addText(title, {
      x: MARGIN,
      y: 2.0,
      w: SLIDE_W - MARGIN * 2,
      h: 1.0,
      fontSize: 30,
      bold: true,
      color: COLOR.ink,
      align: 'left',
    });
    s.addText(template.whenToUse || '', {
      x: MARGIN,
      y: 3.05,
      w: SLIDE_W - MARGIN * 2,
      h: 0.8,
      fontSize: 14,
      color: COLOR.muted,
      align: 'left',
    });
    // 上部の細い淡色アクセントライン。
    s.addShape(pptx.ShapeType.rect, {
      x: MARGIN,
      y: 1.7,
      w: 2.2,
      h: 0.06,
      fill: { color: COLOR.accent },
      line: { type: 'none' },
    });
  }

  // ── スライド2: 本文（メッセージライン + placeholders） ─────────────
  {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };

    // メッセージライン用の空枠（messageLineExample をグレーのプレースホルダ表示）。
    s.addShape(pptx.ShapeType.rect, {
      x: MARGIN,
      y: 0.35,
      w: SLIDE_W - MARGIN * 2,
      h: 0.7,
      fill: { color: COLOR.band },
      line: { color: COLOR.line, width: 1 },
    });
    s.addText(template.messageLineExample || '（メッセージライン：このスライドの結論を一文で）', {
      x: MARGIN + 0.15,
      y: 0.35,
      w: SLIDE_W - MARGIN * 2 - 0.3,
      h: 0.7,
      fontSize: 13,
      italic: true,
      color: COLOR.guide,
      align: 'left',
      valign: 'middle',
    });

    // 本文領域に placeholders を縦積みのボックスで配置する。
    const bodyTop = 1.35;
    const bodyBottom = 5.3;
    const count = Math.max(1, placeholders.length);
    const gap = 0.18;
    const boxH = Math.max(0.5, (bodyBottom - bodyTop - gap * (count - 1)) / count);

    if (placeholders.length === 0) {
      s.addText('（このテンプレートには記入欄定義がありません）', {
        x: MARGIN,
        y: bodyTop,
        w: SLIDE_W - MARGIN * 2,
        h: 0.5,
        fontSize: 12,
        color: COLOR.guide,
        italic: true,
      });
    } else {
      placeholders.forEach((ph, i) => {
        const y = bodyTop + i * (boxH + gap);
        const isBullet = ph.type === 'bullet' || ph.type === 'text';
        // ラベル（左肩の小見出し）。
        s.addText(ph.label, {
          x: MARGIN,
          y,
          w: SLIDE_W - MARGIN * 2,
          h: 0.24,
          fontSize: 11,
          bold: true,
          color: COLOR.accent,
          align: 'left',
        });
        // 記入枠（淡色面 + 枠線）。
        s.addShape(pptx.ShapeType.rect, {
          x: MARGIN,
          y: y + 0.26,
          w: SLIDE_W - MARGIN * 2,
          h: Math.max(0.28, boxH - 0.26),
          fill: { color: COLOR.band },
          line: { color: COLOR.line, width: 1 },
        });
        // 枠内ガイド文（薄いグレー）。bullet 系は行頭記号風に。
        const inner = guideText(ph);
        s.addText(isBullet ? `・${inner}` : inner, {
          x: MARGIN + 0.15,
          y: y + 0.26,
          w: SLIDE_W - MARGIN * 2 - 0.3,
          h: Math.max(0.28, boxH - 0.26),
          fontSize: 11,
          italic: true,
          color: COLOR.guide,
          align: 'left',
          valign: 'top',
        });
      });
    }

    // レイアウト指示は speaker notes へ。
    if (template.layout) s.addNotes(`レイアウト: ${template.layout}`);
  }

  // ── スライド3: チェックリスト（tips） ─────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addText('作成チェックリスト', {
      x: MARGIN,
      y: 0.4,
      w: SLIDE_W - MARGIN * 2,
      h: 0.6,
      fontSize: 20,
      bold: true,
      color: COLOR.ink,
    });
    const tips = Array.isArray(template.tips) ? template.tips : [];
    if (tips.length === 0) {
      s.addText('（チェック項目はありません）', {
        x: MARGIN,
        y: 1.2,
        w: SLIDE_W - MARGIN * 2,
        h: 0.5,
        fontSize: 12,
        color: COLOR.guide,
        italic: true,
      });
    } else {
      s.addText(
        tips.map((t) => ({ text: t, options: { bullet: { characterCode: '2713' } } })),
        {
          x: MARGIN,
          y: 1.2,
          w: SLIDE_W - MARGIN * 2,
          h: 4.0,
          fontSize: 14,
          color: COLOR.ink,
          lineSpacingMultiple: 1.3,
          valign: 'top',
        },
      );
    }
  }

  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return out;
}
