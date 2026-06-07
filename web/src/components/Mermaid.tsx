// Mermaid — ```mermaid コードブロックを SVG 図解として描画する。
//
// 方針:
//  - mermaid は重いので dynamic import で初回バンドルを肥大させない。
//  - 描画失敗（不正な構文等）はキャッチして元コードをそのまま表示し、
//    画面をクラッシュさせない（フォールバック）。
//  - テーマはダーク/ライトを html.dark で判定し、背景は var(--mc-*) に馴染ませる。

import { useEffect, useRef, useState } from 'react';

let mermaidIdSeq = 0;

// 同一ページに複数図があってもユニークになる id を払い出す。
function nextId(): string {
  mermaidIdSeq += 1;
  return `mc-mermaid-${mermaidIdSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef<string>(nextId());

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        const isDark = document.documentElement.classList.contains('dark');
        // CSS 変数（実値）を拾って mermaid のテーマ変数に流し込む。
        const cs = getComputedStyle(document.documentElement);
        const v = (name: string, fallback: string) =>
          cs.getPropertyValue(name).trim() || fallback;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          fontFamily:
            "ui-sans-serif, system-ui, 'Hiragino Sans', 'Noto Sans JP', sans-serif",
          themeVariables: {
            background: v('--mc-surface', isDark ? '#131b2e' : '#ffffff'),
            primaryColor: v('--mc-surface-2', isDark ? '#1b2540' : '#edf0f5'),
            primaryBorderColor: v('--mc-border-strong', isDark ? '#3b4d75' : '#b0bcce'),
            primaryTextColor: v('--mc-text', isDark ? '#e8edf7' : '#1e2a3a'),
            secondaryColor: v('--mc-surface-3', isDark ? '#243152' : '#e2e7ef'),
            tertiaryColor: v('--mc-bg', isDark ? '#0b1120' : '#f4f6f9'),
            lineColor: v('--mc-accent', isDark ? '#5b9dff' : '#3b7dd8'),
            textColor: v('--mc-text', isDark ? '#e8edf7' : '#1e2a3a'),
            mainBkg: v('--mc-surface-2', isDark ? '#1b2540' : '#edf0f5'),
            nodeBorder: v('--mc-border-strong', isDark ? '#3b4d75' : '#b0bcce'),
            clusterBkg: v('--mc-bg', isDark ? '#0b1120' : '#f4f6f9'),
            clusterBorder: v('--mc-border', isDark ? '#2c3a5a' : '#d0d8e4'),
            edgeLabelBackground: v('--mc-surface', isDark ? '#131b2e' : '#ffffff'),
          },
        });

        const { svg: rendered } = await mermaid.render(idRef.current, code.trim());
        if (!cancelled) setSvg(rendered);
      } catch {
        // 不正な図でもクラッシュさせず、元コードを表示する。
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    // フォールバック: 描画できない場合は元のコードをそのまま表示。
    return (
      <pre className="mc-news-mermaid-fallback">
        <code>{code}</code>
      </pre>
    );
  }

  if (svg == null) {
    return (
      <div className="mc-news-mermaid mc-news-mermaid-loading" aria-hidden>
        図を描画しています…
      </div>
    );
  }

  return (
    <div
      className="mc-news-mermaid"
      role="img"
      aria-label="図解"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
