// 育児ページ（/childcare, MC-226 Phase1）。
// 第一子（男児）の誕生日を基準に、いま来るもの／成長タイムライン／父親の役割／
// 行政手続き／健診・予防接種を静的 curated データから描画する。
// 医療・制度情報は「目安／要確認」を徹底（断定しない）。AI/RAG 連携は後続フェーズ。
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '../components/PageHeader';
import ChatMarkdown from '../components/ChatMarkdown';
import {
  BabyIcon,
  ChildcareChatIcon,
  CloseIcon,
  DiaryIcon,
  ImageFileIcon,
  SendIcon,
} from '../components/icons';
import BabyDiary from './BabyDiary';
import {
  BIRTH_DATE,
  BABY_SEX_LABEL,
  RESIDENCE,
  daysSinceBirth,
  weeksAndDays,
  ageInMonths,
  formatJpDate,
  daysUntil,
  upcomingDueItems,
  GROWTH_STAGES,
  GROWTH_DISCLAIMER,
  FATHER_TASKS,
  FATHER_DISCLAIMER,
  FATHER_MINDSET,
  FATHER_MINDSET_DISCLAIMER,
  BUNKYO_SERVICES,
  BUNKYO_CAPTION,
  PERKS_PUBLIC,
  PERKS_PRIVATE,
  PERKS_CAPTION,
  ADMIN_PROCEDURES,
  ADMIN_CAPTION,
  CHECKUP_ITEMS,
  CHECKUP_CAPTION,
  nextMilestoneProgress,
  CARE_BASICS,
  CARE_BASICS_CAPTION,
  DAILY_RHYTHM,
  DAILY_RHYTHM_CAPTION,
  NIGHT_CRYING,
  WHEN_TO_SEE_DOCTOR,
  EMERGENCY_PHONES,
  WHEN_TO_SEE_DOCTOR_SOURCE,
  WHEN_TO_SEE_DOCTOR_CAPTION,
  SIDS_PREVENTION,
  SIDS_SOURCE,
  SIDS_URL,
  VACCINE_SCHEDULE,
  VACCINE_SCHEDULE_CAPTION,
  VACCINE_SCHEDULE_SOURCE,
  VACCINE_SCHEDULE_URL,
} from './childcareData';
import type { AdminProcedure, CareBasic, CheckupItem } from './childcareData';

// ─── 締切の緊急度 → 表示色／ラベル ───────────────────────────
// 超過: blocked（オレンジ・警告）。本日〜7日内: review（強調）。それ以降: 通常。
type Urgency = 'overdue' | 'soon' | 'later';

function urgencyOf(dueIso: string, now: Date): Urgency {
  const d = daysUntil(dueIso, now);
  if (d < 0) return 'overdue';
  if (d <= 7) return 'soon';
  return 'later';
}

function dueLabel(dueIso: string, now: Date): string {
  const d = daysUntil(dueIso, now);
  if (d < 0) return `期限を${Math.abs(d)}日超過`;
  if (d === 0) return '本日';
  if (d === 1) return '明日';
  return `あと${d}日`;
}

function UrgencyBadge({ urgency, dueIso, now }: { urgency: Urgency; dueIso: string; now: Date }) {
  const cls =
    urgency === 'overdue'
      ? 'bg-blocked-bg text-blocked'
      : urgency === 'soon'
        ? 'bg-review-bg text-review'
        : 'bg-surface-2 text-text-muted';
  const text = urgency === 'overdue' ? `期限注意・${dueLabel(dueIso, now)}` : dueLabel(dueIso, now);
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold leading-none ${cls}`}>
      {text}
    </span>
  );
}

// ─── 小さな見出し ──────────────────────────────────────────
function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-bold text-text">{children}</h2>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

// ─── 注記（目安／要確認の枠） ───────────────────────────────
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
      {children}
    </p>
  );
}

// ─── 外部リンク（公式ページへ・新規タブ） ──────────────────
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {children}
    </a>
  );
}

// ─── ヘッダ（生後 N 日 …） ──────────────────────────────────
function BabyHeader({ now }: { now: Date }) {
  const days = daysSinceBirth(now);
  const { weeks, days: wd } = weeksAndDays(now);
  const months = ageInMonths(now);
  return (
    <div className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <p className="text-xs text-text-muted">
        第一子・{BABY_SEX_LABEL}（{formatJpDate(BIRTH_DATE)} 誕生）・{RESIDENCE}在住
      </p>
      <p className="mt-1 text-2xl font-bold text-text md:text-3xl">
        生後 <span className="text-accent">{days}</span> 日
      </p>
      <p className="mt-1 text-sm text-text-muted">
        {weeks}週{wd}日 / {months}か月
      </p>
    </div>
  );
}

// ─── セクション（新）: 次の節目までの進捗 ───────────────────
function NextMilestoneSection({ now }: { now: Date }) {
  const { next, daysLeft, percent } = nextMilestoneProgress(now);
  return (
    <section className="rounded-lg border border-accent/40 bg-surface p-4 md:p-5">
      {next ? (
        <>
          <p className="text-sm text-text-muted">
            次は <span className="font-bold text-text">「{next.label}」</span> まで
            <span className="ml-1 text-lg font-bold text-accent">あと{daysLeft}日</span>
          </p>
          <div
            className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${next.label}までの進捗 ${percent}%`}
          >
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-text-faint">
            目安の生後日数からの算出値です（{percent}%）。日程は自治体・医療機関でご確認ください。
          </p>
        </>
      ) : (
        <p className="text-sm text-text-muted">
          主要な節目（1か月健診・予防接種スタート・3–4か月健診）の目安時期を過ぎました。以降の予定は下部の各セクションをご確認ください。
        </p>
      )}
    </section>
  );
}

// ─── セクション①: いま来るもの ─────────────────────────────
function UpcomingSection({ now }: { now: Date }) {
  // 締切が近い順に上位5件。
  const items = upcomingDueItems(now).slice(0, 5);
  return (
    <section className="rounded-lg border border-accent/40 bg-surface p-4 md:p-5">
      <SectionTitle hint="締切・予定日が近い順。期限超過は「期限注意」、本日〜数日内は強調表示します。">
        ⏰ いま来るもの（直近の締切・予定）
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {items.map((it) => {
          const urgency = urgencyOf(it.dueIso, now);
          const ring =
            urgency === 'overdue'
              ? 'border-blocked/50'
              : urgency === 'soon'
                ? 'border-review/50'
                : 'border-border';
          return (
            <li
              key={it.id}
              className={`flex items-start justify-between gap-3 rounded-md border ${ring} bg-bg px-3 py-2.5`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text">{it.title}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  目安日: {formatJpDate(it.dueIso)}（{it.kind === 'admin' ? '行政手続き' : '健診・予防接種'}）
                </p>
              </div>
              <UrgencyBadge urgency={urgency} dueIso={it.dueIso} now={now} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── セクション②: 成長タイムライン（縦ステップ表示） ──────
function GrowthSection({ now }: { now: Date }) {
  const months = ageInMonths(now);
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="現在の月齢のノードを「いまここ」として塗り、過去は淡色・未来は枠線のみで表示します。">
        📈 成長タイムライン（発達の目安）
      </SectionTitle>
      <ol className="flex flex-col">
        {GROWTH_STAGES.map((stage, idx) => {
          const active =
            months >= stage.fromMonth && (stage.toMonth === null || months < stage.toMonth);
          const past = stage.toMonth !== null && months >= stage.toMonth;
          const isLast = idx === GROWTH_STAGES.length - 1;
          // ノードの見た目: いまここ=塗り(accent)、過去=淡色塗り、未来=枠線のみ。
          const node = active
            ? 'border-accent bg-accent'
            : past
              ? 'border-accent/30 bg-accent/30'
              : 'border-border bg-transparent';
          const line = past || active ? 'bg-accent/30' : 'bg-border';
          return (
            <li key={stage.label} className="flex gap-3">
              {/* 左: 丸ノード＋縦線 */}
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${node}`}
                />
                {!isLast && <span aria-hidden className={`w-0.5 flex-1 ${line}`} />}
              </div>
              {/* 右: 内容 */}
              <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-4'}`}>
                <p className={`text-sm font-semibold ${active ? 'text-accent' : past ? 'text-text-muted' : 'text-text'}`}>
                  {stage.label}
                  {active && <span className="ml-2 text-[11px] font-bold text-accent">いまここ</span>}
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed text-text-muted">
                  {stage.points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
      <Note>{GROWTH_DISCLAIMER}</Note>
    </section>
  );
}

// ─── セクション③: 父親としてやること ──────────────────────
function FatherSection() {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="産後すぐ〜産褥期に夫が担いたい役割のチェックリストです。">
        👨‍🍼 父親（夫）としてやること
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {FATHER_TASKS.map((t) => (
          <li key={t.title} className="flex items-start gap-2.5 rounded-md border border-border bg-bg px-3 py-2.5">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border text-[10px] text-text-faint"
            >
              ☐
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text">{t.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{t.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      <Note>{FATHER_DISCLAIMER}</Note>
    </section>
  );
}

// ─── 追加セクションA: 父親としてのマインドセット ──────────
function FatherMindsetSection() {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="パートナーと協力して育児に向き合うための、父親（夫）の心構えの目安です。">
        🧭 父親としてのマインドセット
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {FATHER_MINDSET.map((m) => (
          <li key={m.title} className="rounded-md border border-border bg-bg px-3 py-2.5">
            <p className="text-sm font-semibold text-text">{m.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{m.detail}</p>
          </li>
        ))}
      </ul>
      <Note>{FATHER_MINDSET_DISCLAIMER}</Note>
    </section>
  );
}

// ─── 締切付き項目の共通カード（行政手続き／健診） ──────────
function DueCard({
  item,
  now,
}: {
  item: AdminProcedure | CheckupItem;
  now: Date;
}) {
  const urgency = urgencyOf(item.dueIso, now);
  const top = item.kind === 'admin' && item.topPriority;
  const ring = top
    ? 'border-accent/60'
    : urgency === 'overdue'
      ? 'border-blocked/50'
      : urgency === 'soon'
        ? 'border-review/50'
        : 'border-border';
  return (
    <li className={`rounded-md border ${ring} bg-bg px-3 py-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">
            {item.title}
            {top && <span className="ml-2 text-[11px] font-bold text-accent">最優先</span>}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            目安日: {formatJpDate(item.dueIso)}
          </p>
        </div>
        <UrgencyBadge urgency={urgency} dueIso={item.dueIso} now={now} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-text-muted">{item.dueNote}</p>
      {'where' in item && (
        <p className="mt-1 text-xs text-text-muted">窓口: {item.where}</p>
      )}
      {item.body.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed text-text-muted">
          {item.body.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-text-faint">{item.source}</p>
    </li>
  );
}

// ─── セクション④: 行政手続き ───────────────────────────────
function AdminSection({ now }: { now: Date }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="日付で決まるものは誕生日から算出しています（算出値は要確認）。">
        📋 行政手続き（締切付き・先回り）
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {ADMIN_PROCEDURES.map((p) => (
          <DueCard key={p.id} item={p} now={now} />
        ))}
      </ul>
      <Note>{ADMIN_CAPTION}</Note>
    </section>
  );
}

// ─── 追加セクションB: 文京区独自の手続き・サービス ─────────
function BunkyoSection() {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint={BUNKYO_CAPTION}>🏛️ {RESIDENCE}独自の手続き・サービス</SectionTitle>
      <ul className="flex flex-col gap-2">
        {BUNKYO_SERVICES.map((s) => (
          <li key={s.title} className="rounded-md border border-border bg-bg px-3 py-3">
            <p className="text-sm font-semibold text-text">{s.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{s.detail}</p>
            {s.contact && <p className="mt-1 text-xs text-text-muted">{s.contact}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {s.url && <ExternalLink href={s.url}>区公式ページ ↗</ExternalLink>}
              <span className="text-[11px] text-text-faint">{s.source}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── 追加セクションC: お得・特典（役所＋民間） ──────────────
function PerksSection() {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint={PERKS_CAPTION}>💰 知っておくとお得・特典（役所＋民間）</SectionTitle>

      <h3 className="mb-2 text-sm font-bold text-text">役所・公的</h3>
      <ul className="flex flex-col gap-2">
        {PERKS_PUBLIC.map((p) => (
          <li key={p.title} className="rounded-md border border-border bg-bg px-3 py-3">
            <p className="text-sm font-semibold text-text">{p.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{p.detail}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {p.url && <ExternalLink href={p.url}>公式ページ ↗</ExternalLink>}
              <span className="text-[11px] text-text-faint">{p.source}</span>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="mb-2 mt-4 text-sm font-bold text-text">民間・お得</h3>
      <ul className="flex flex-col gap-2">
        {PERKS_PRIVATE.map((p) => (
          <li key={p.title} className="rounded-md border border-border bg-bg px-3 py-3">
            <p className="text-sm font-semibold text-text">{p.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{p.detail}</p>
            {p.url && (
              <div className="mt-2">
                <ExternalLink href={p.url}>公式ページ ↗</ExternalLink>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── セクション⑤: 健診・予防接種 ───────────────────────────
function CheckupSection({ now }: { now: Date }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="日程は自治体・医療機関で確認を。予防接種は同時接種が標準です。">
        🩺 健診・予防接種（先回り）
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {CHECKUP_ITEMS.map((c) => (
          <DueCard key={c.id} item={c} now={now} />
        ))}
      </ul>
      <Note>{CHECKUP_CAPTION}</Note>
    </section>
  );
}

// ─── セクション（新）: お世話の基本 ────────────────────────
// 各項目をタップ可能（button）にし、選択項目を1つの詳細モーダル（CareBasicDetail）で表示。
// 詳細では要点＋信頼できる発信元の解説動画（YouTube プライバシー強化埋め込み）を見せる。
function CareBasicsSection() {
  // 選択中の項目（null で閉じている状態）。
  const [selected, setSelected] = useState<CareBasic | null>(null);
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="新生児期のお世話の一般的な目安です。タップで要点と解説動画が見られます。">
        👶 お世話の基本
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {CARE_BASICS.map((c) => {
          const hasVideo = Boolean(c.videoId);
          return (
            <li key={c.title}>
              <button
                type="button"
                onClick={() => setSelected(c)}
                aria-label={`${c.title}の詳細を開く（${hasVideo ? '解説動画あり' : '解説ページあり'}）`}
                aria-haspopup="dialog"
                className="flex w-full cursor-pointer items-start gap-2.5 rounded-md border border-border bg-bg px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
              >
                <span aria-hidden className="text-lg leading-none">{c.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-text">{c.title}</p>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold leading-none text-accent">
                      <span aria-hidden>▶</span>
                      {hasVideo ? '動画' : '解説'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{c.detail}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <Note>{CARE_BASICS_CAPTION}</Note>
      <CareBasicDetail item={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

// ─── お世話の基本: 詳細モーダル ─────────────────────────────
// BabyDiary の TaskDetail 作法に倣う: createPortal で body 直下、fixed inset-0 z-50、
// 背面オーバーレイ button、Esc クローズ＋背面スクロールロック、上端 accent ボーダー。
// item が null の間は何も描画しない（閉じている状態）。
function CareBasicDetail({ item, onClose }: { item: CareBasic | null; onClose: () => void }) {
  const open = item !== null;
  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  if (!item) return null;

  const credit = item.sourceType ? `${item.source}（${item.sourceType}）` : item.source;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`お世話の基本: ${item.title}`}
    >
      {/* 背面オーバーレイ（クリックで閉じる） */}
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      {/* モーダル本体 */}
      <div
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-lg border border-border bg-bg shadow-xl md:rounded-lg"
        style={{ borderTop: '3px solid var(--mc-accent)' }}
      >
        {/* ヘッダ */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
          <h2 className="mt-0.5 flex min-w-0 items-center gap-2 break-words text-[15px] font-bold leading-snug text-text">
            <span aria-hidden className="text-lg leading-none">{item.emoji}</span>
            {item.title}
          </h2>
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
          {/* 要点 */}
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
            {item.detail}
          </p>

          {/* 解説動画 / 解説ページ */}
          <div className="mt-4">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-faint">
              解説{item.videoId ? '動画' : 'ページ'}
            </h3>
            {item.videoId ? (
              <div className="overflow-hidden rounded-md border border-border bg-surface-2">
                <iframe
                  className="aspect-video w-full"
                  src={`https://www.youtube-nocookie.com/embed/${item.videoId}`}
                  title={item.videoTitle ?? `${item.title}の解説動画`}
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            ) : (
              item.watchUrl && (
                <a
                  href={item.watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 px-3 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/20"
                >
                  {item.videoTitle ?? '解説ページ'}を開く ↗
                </a>
              )
            )}
            {item.videoTitle && item.videoId && (
              <p className="mt-2 text-xs leading-relaxed text-text-muted">{item.videoTitle}</p>
            )}
          </div>

          {/* 発信元クレジット */}
          {credit && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[11px] text-text-faint">発信元: {credit}</span>
              {item.videoId && item.watchUrl && (
                <ExternalLink href={item.watchUrl}>YouTube で開く ↗</ExternalLink>
              )}
            </div>
          )}

          {item.caveat && (
            <p className="mt-2 text-[11px] leading-relaxed text-text-faint">{item.caveat}</p>
          )}

          <Note>※発信元の動画/ページです。内容は各発信元をご確認ください。</Note>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── セクション（新）: 新生児の1日のリズム（ビジュアル） ────
function DailyRhythmSection() {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="新生児期のおおよその1日のリズムの目安です。">
        🕒 新生児の1日のリズム（目安）
      </SectionTitle>
      <ul className="flex flex-col gap-2.5">
        {DAILY_RHYTHM.map((r) => (
          <li key={r.label} className="rounded-md border border-border bg-bg px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span aria-hidden className="text-base leading-none">{r.icon}</span>
              <p className="text-sm font-semibold text-text">{r.label}</p>
              <p className="ml-auto text-xs text-text-muted">{r.value}</p>
            </div>
          </li>
        ))}
      </ul>
      <Note>{DAILY_RHYTHM_CAPTION}</Note>
    </section>
  );
}

// ─── セクション（新）: 夜泣き・ぐずり対応 ──────────────────
function NightCryingSection() {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="泣き止まないときの一般的な対応の目安です。">🌙 夜泣き・ぐずり対応</SectionTitle>
      <ul className="flex flex-col gap-2">
        {NIGHT_CRYING.map((n) => (
          <li key={n.title} className="rounded-md border border-border bg-bg px-3 py-2.5">
            <p className="text-sm font-semibold text-text">{n.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{n.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── セクション（新）: 受診の目安・困ったとき ＋ 緊急電話 ──
function WhenToSeeDoctorSection() {
  return (
    <section className="rounded-lg border border-blocked/40 bg-surface p-4 md:p-5">
      <SectionTitle hint="迷ったら電話相談・医療機関へ。一般的な目安です。">
        🚨 受診の目安・困ったとき
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {WHEN_TO_SEE_DOCTOR.map((w) => (
          <li key={w.title} className="rounded-md border border-border bg-bg px-3 py-2.5">
            <p className="text-sm font-semibold text-text">{w.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{w.detail}</p>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {EMERGENCY_PHONES.map((p) => (
          <a
            key={p.label}
            href={`tel:${p.tel}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-blocked/50 bg-blocked-bg px-3 py-1.5 text-xs font-bold text-blocked"
          >
            <span aria-hidden>📞</span>
            {p.label} {p.number}
          </a>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-text-faint">{WHEN_TO_SEE_DOCTOR_SOURCE}</p>
      <Note>{WHEN_TO_SEE_DOCTOR_CAPTION}</Note>
    </section>
  );
}

// ─── セクション（新）: SIDS 予防（厚労省3か条） ─────────────
function SidsSection() {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="厚生労働省の3か条。リスクを減らすためのポイントです。">
        🛏️ 乳幼児突然死症候群（SIDS）予防
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {SIDS_PREVENTION.map((s, i) => (
          <li key={s.title} className="flex items-start gap-2.5 rounded-md border border-border bg-bg px-3 py-2.5">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold text-accent"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text">{s.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{s.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <ExternalLink href={SIDS_URL}>政府広報オンライン ↗</ExternalLink>
        <span className="text-[11px] text-text-faint">{SIDS_SOURCE}</span>
      </div>
    </section>
  );
}

// ─── セクション（新）: 予防接種スケジュール（タイムライン） ─
function VaccineScheduleSection({ now }: { now: Date }) {
  const months = ageInMonths(now);
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="現在の月齢の列をハイライトしています。同時接種が標準です。">
        💉 予防接種スケジュール（標準）
      </SectionTitle>
      {/* PC: 横並びタイムライン / モバイル: 縦並び。 */}
      <ol className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-2">
        {VACCINE_SCHEDULE.map((m) => {
          const active = months >= m.fromMonth && (m.toMonth === null || months < m.toMonth);
          return (
            <li
              key={m.label}
              className={`flex-1 rounded-md border px-3 py-3 ${
                active ? 'border-accent/60 bg-accent/10' : 'border-border bg-bg'
              }`}
            >
              <p className={`text-sm font-bold ${active ? 'text-accent' : 'text-text'}`}>
                {m.label}
                {active && <span className="ml-2 text-[11px] font-bold text-accent">いまここ</span>}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.vaccines.map((v) => (
                  <span
                    key={v}
                    className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] leading-none text-text-muted"
                  >
                    {v}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <ExternalLink href={VACCINE_SCHEDULE_URL}>厚生労働省（予防接種） ↗</ExternalLink>
        <span className="text-[11px] text-text-faint">{VACCINE_SCHEDULE_SOURCE}</span>
      </div>
      <Note>{VACCINE_SCHEDULE_CAPTION}</Note>
    </section>
  );
}

// ─── セクション（新）: 相談メモ（育児チャットの Q&A をトピック別に整理）──────
// 育児ガイドを開いたとき GET /api/childcare/guide-notes を呼ぶ。サーバ側で「前回まとめ以降の
// 新しい相談だけ」を差分処理してトピック別の要点に整理し、永続キャッシュから返す。
// まだ相談が無いときは空状態を出す。更新中（generating）はローディングを出し、少し待って再取得する。
interface GuideNoteTopic {
  topic: string;
  title: string;
  points: string[];
}
interface GuideNotesResponse {
  topics: GuideNoteTopic[];
  updatedAt: string | null;
  generating: boolean;
}

function formatUpdatedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ConsultationNotesSection() {
  const [topics, setTopics] = useState<GuideNoteTopic[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // 初回ロード中（まだ一度もデータを受け取っていない）。
  const [loading, setLoading] = useState(true);
  // 取得失敗（致命ではなく、本文は隠してリトライ案内のみ出す）。
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchNotes = async (isRetry: boolean) => {
      try {
        const res = await fetch('/api/childcare/guide-notes', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GuideNotesResponse;
        if (cancelled) return;
        setTopics(Array.isArray(data.topics) ? data.topics : []);
        setUpdatedAt(typeof data.updatedAt === 'string' ? data.updatedAt : null);
        setFailed(false);
        setLoading(false);
        // 裏で差分更新中（別リクエストが統合中）なら、少し待ってもう一度取りに行く。
        if (data.generating && !isRetry) {
          retryTimer = setTimeout(() => void fetchNotes(true), 5000);
        }
      } catch {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      }
    };

    void fetchNotes(false);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  const updatedLabel = formatUpdatedAt(updatedAt);

  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="育児チャット「すくすく」での相談を、トピック別に要点整理しています。ガイドを開くたびに新しい相談を反映します。">
        📝 相談メモ（育児チャットの記録）
      </SectionTitle>

      {loading ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-3 text-xs text-text-muted">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
          相談メモを整理しています…
        </div>
      ) : failed ? (
        <p className="rounded-md border border-border bg-bg px-3 py-3 text-xs text-text-muted">
          相談メモの読み込みに失敗しました。少し時間をおいて再度お試しください。
        </p>
      ) : topics.length === 0 ? (
        <p className="rounded-md border border-border bg-bg px-3 py-3 text-xs leading-relaxed text-text-muted">
          育児チャットで相談すると、ここに要点が整理されてたまっていきます。
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {topics.map((t) => (
              <li key={t.topic} className="rounded-md border border-border bg-bg px-3 py-3">
                <p className="text-sm font-semibold text-text">{t.title}</p>
                <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed text-text-muted">
                  {t.points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {updatedLabel && (
            <p className="mt-2 text-[11px] text-text-faint">最終更新: {updatedLabel}</p>
          )}
        </>
      )}
      <Note>
        育児チャットの相談を一般的な目安として整理したものです。健康上の心配や緊急時は小児科・小児救急電話相談（#8000）にご相談ください。
      </Note>
    </section>
  );
}

// ─── 育児ガイド本体（従来の /childcare の中身。タブシェル配下に描画）──
function ChildcareGuide() {
  // クライアントの現在日を基準に算出（マウント時に固定）。
  const now = new Date();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      {/* ヘッダ → 次の節目 → 成長タイムライン → いま来るもの を全幅で上部固定。 */}
      <BabyHeader now={now} />
      <NextMilestoneSection now={now} />
      <GrowthSection now={now} />
      <UpcomingSection now={now} />
      {/* 相談メモ（育児チャットの Q&A をトピック別に整理）。本体の静的コンテンツの上に置く。 */}
      <ConsultationNotesSection />
      {/* PC（lg〜）は2分割（CSS マルチカラムのメイソンリー）、モバイルは1列。
          各ラッパに break-inside-avoid を当て、カードが列をまたいで割れないようにする。 */}
      <div className="columns-1 gap-4 lg:columns-2">
        {[
          <CareBasicsSection key="care" />,
          <DailyRhythmSection key="rhythm" />,
          <NightCryingSection key="night" />,
          <FatherMindsetSection key="mindset" />,
          <FatherSection key="father" />,
          <WhenToSeeDoctorSection key="doctor" />,
          <SidsSection key="sids" />,
          <AdminSection key="admin" now={now} />,
          <BunkyoSection key="bunkyo" />,
          <PerksSection key="perks" />,
          <CheckupSection key="checkup" now={now} />,
        ].map((node) => (
          <div key={node.key} className="mb-4 break-inside-avoid">
            {node}
          </div>
        ))}
      </div>
      {/* 全幅・下部: 予防接種スケジュールのビジュアル・タイムライン。 */}
      <VaccineScheduleSection now={now} />
    </div>
  );
}

// ─── 育児相談チャット「すくすく」 ─────────────────────────────────────
// 専用タブ「育児チャット」と右下 FAB の両方から開く。どちらも同じサーバ履歴を共有する
// （正本は data/childcare-chat.jsonl）。タブはチャット UI と過去の会話履歴を主役にした画面、
// FAB は他タブ（成長日記・育児ガイド）からチャットへ素早く飛ぶ導線（タブへ遷移）。
//
// - 会話履歴はサーバ側 JSONL を正本に蓄積し（GET /api/childcare/chat/history で復元）、
//   localStorage は端末ローカルのキャッシュ/フォールバックとして併用する。
//   マウント/オープン時にサーバ履歴を取り込むので、リロード・別端末・再オープンで過去の質問が残る。
// - アシスタント返答は Markdown として整形して表示（ChatMarkdown）。ユーザー発言は素のテキスト。
// - 入力欄から画像/動画を添付・アップロードできる（POST /chat/upload → 送信時に media 参照を付与）。
//   メディアはチャットに表示し（画像インライン・動画 <video>）、履歴にも残る。
// - 赤ちゃんの個別データは一切渡さない（育児専門知識の一般的な範囲のみ）。
type SukuRole = 'user' | 'assistant';
interface SukuMedia {
  id: string;
  // 'image'/'video' は実体配信、'youtube' は埋め込み（返信側の参考動画）。
  kind: 'image' | 'video' | 'youtube';
  url: string;
  mime: string;
  name?: string;
  size?: number;
  // 出所: 'upload'=保護者添付 / 'generated'=すくすく生成図解 / 'web'=検証済み YouTube・公式画像。
  source?: 'upload' | 'generated' | 'web';
  // キャプション（なぜおすすめか・図解の説明）。
  caption?: string;
  // YouTube 埋め込み用の videoId（kind==='youtube' のとき）。
  videoId?: string;
  // 出典・帰属表示用 URL（YouTube 視聴元 / 画像の出典ページ）。
  sourceUrl?: string;
  // 出典タイトル（帰属表示に使う）。
  sourceTitle?: string;
}
// 生成状態。'pending'=生成中（考え中…）/ 'done'=完了 / 'error'=失敗（丁寧メッセージ確定）。
type SukuStatus = 'pending' | 'done' | 'error';
interface SukuMessage {
  role: SukuRole;
  content: string;
  media?: SukuMedia[];
  // assistant のみ pending/error を取りうる（省略時は done 相当）。
  status?: SukuStatus;
  // ジョブ相関キー（pending を job ステータスで解決するため）。
  jobId?: string;
}

const SUKU_STORAGE_KEY = 'apollo.childcareChat.history.v1';
const SUKU_WELCOME =
  'すくすくです。乳幼児育児の専門アドバイザーとして、お悩みにお答えします。睡眠・寝かしつけ、授乳・離乳食、月齢ごとの発達の目安、生活リズム、関わり方など、お気軽にご相談ください。写真や動画を添付してご相談いただくこともできます（一般的な目安としてご案内します）。';

const SUKU_SAFETY_NOTE =
  '一般的な育児情報の目安です。健康上の心配や緊急時は小児科・小児救急電話相談（#8000）にご相談ください。写真からの診断はいたしません。';

/** メッセージ配列を検証・正規化する（サーバ/localStorage どちらの入力にも使う）。 */
function normalizeMessages(parsed: unknown): SukuMessage[] {
  if (!Array.isArray(parsed)) return [];
  const out: SukuMessage[] = [];
  for (const m of parsed) {
    const role = (m as SukuMessage)?.role;
    const content = (m as SukuMessage)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const msg: SukuMessage = { role, content };
    const status = (m as SukuMessage)?.status;
    if (status === 'pending' || status === 'error' || status === 'done') msg.status = status;
    const jobId = (m as SukuMessage)?.jobId;
    if (typeof jobId === 'string' && jobId) msg.jobId = jobId;
    const media = (m as SukuMessage)?.media;
    if (Array.isArray(media)) {
      const list = media.filter((x): x is SukuMedia => {
        if (!x || typeof (x as SukuMedia).id !== 'string') return false;
        const k = (x as SukuMedia).kind;
        if (k === 'image' || k === 'video') {
          return typeof (x as SukuMedia).url === 'string';
        }
        // YouTube は埋め込みのため videoId が要る（url は視聴ページ）。
        if (k === 'youtube') {
          return typeof (x as SukuMedia).videoId === 'string' && !!(x as SukuMedia).videoId;
        }
        return false;
      });
      if (list.length > 0) msg.media = list;
    }
    out.push(msg);
  }
  return out;
}

/** 末尾の pending な assistant バブルを確定メッセージで置き換える（無ければ末尾に追加）。 */
function replaceLastPending(list: SukuMessage[], finalMsg: SukuMessage): SukuMessage[] {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m.role === 'assistant' && m.status === 'pending') {
      const out = list.slice();
      out[i] = finalMsg;
      return out;
    }
  }
  return [...list, finalMsg];
}

/** localStorage から会話履歴を復元する（壊れていれば空配列）。 */
function loadSukuHistory(): SukuMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SUKU_STORAGE_KEY);
    if (!raw) return [];
    return normalizeMessages(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/**
 * すくすくチャットの状態とロジックを 1 箇所に集約するフック。
 * タブ表示と FAB モーダルの両方がこのフックを使い、同じサーバ履歴・送信処理を共有する。
 * （ただし正本はサーバなので、別インスタンス間の即時同期まではしない。各々マウント時に復元する。）
 */
function useSukuChat() {
  const [messages, setMessages] = useState<SukuMessage[]>(() => loadSukuHistory());
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 送信前に添付したメディア（アップロード済みで参照を保持）。
  const [pending, setPending] = useState<SukuMedia[]>([]);
  // ストリーミング中のアシスタント部分応答（確定前のテキスト）。
  const [streaming, setStreaming] = useState<string | null>(null);
  // 進行中ジョブがあるか（pending を解決するためのポーリング駆動に使う）。
  const [hasPending, setHasPending] = useState(false);
  // ストリーミング購読が生きているか（生きている間はポーリング resync を抑止して二重描画を避ける）。
  const streamingRef = useRef(false);

  // 履歴を localStorage に永続化する（端末キャッシュ。正本はサーバ）。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SUKU_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* 容量超過等は無視（チャットは継続できる） */
    }
  }, [messages]);

  // messages に pending の assistant があるかを監視し、ポーリングのオン/オフを切り替える。
  useEffect(() => {
    setHasPending(messages.some((m) => m.role === 'assistant' && m.status === 'pending'));
  }, [messages]);

  /** サーバ保存の会話履歴を取り込んで表示を置き換える（正本）。失敗時はキャッシュのまま。 */
  const restore = useCallback(async () => {
    try {
      const res = await fetch('/api/childcare/chat/history', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: unknown };
      // ストリーミング購読が生きている間はサーバ resync で上書きしない（逐次表示を優先）。
      if (streamingRef.current) return;
      setMessages(normalizeMessages(data.messages));
    } catch {
      /* 取得失敗時は localStorage キャッシュのまま継続 */
    }
  }, []);

  // pending が残っている間、サーバ履歴をポーリングして done/error に解決する。
  // 接続が切れて「通信に失敗しました」を出す代わりに、ここでサーバの結果を取りに行く。
  useEffect(() => {
    if (!hasPending) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || streamingRef.current) return;
      await restore();
    };
    const timer = setInterval(() => void tick(), 4000);
    // タブ復帰・アプリ再オープン時にも即座に取り直す（visibilitychange）。
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasPending, restore]);

  /** ファイル選択 → サーバへアップロードして pending に追加する。 */
  const upload = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of list) form.append('files', f);
      const res = await fetch('/api/childcare/chat/upload', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { media?: SukuMedia[]; error?: string };
      if (!res.ok) {
        setError(data.error || 'アップロードに失敗しました。');
        return;
      }
      const added = Array.isArray(data.media) ? data.media : [];
      setPending((prev) => [...prev, ...added]);
    } catch {
      setError('アップロードに失敗しました。通信状況をご確認ください。');
    } finally {
      setUploading(false);
    }
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((prev) => prev.filter((m) => m.id !== id));
  }, []);

  /**
   * 送信。テキストか添付メディアのどちらかがあれば送れる。
   * AI 生成はサーバ側でバックグラウンド実行され、結果はサーバに永続化される。SSE が繋がっている間は
   * 逐次表示するが、完了の正本はサーバ。接続が切れても「通信に失敗しました」で確定せず、pending の
   * ままにして history ポーリング／タブ復帰で結果を取りに行く（画面を離れて戻っても回答が出る）。
   */
  const send = useCallback(async () => {
    const text = input.trim();
    const media = pending;
    if ((!text && media.length === 0) || sending) return;

    const userMsg: SukuMessage = { role: 'user', content: text || '（画像/動画を添付しました）' };
    if (media.length > 0) userMsg.media = media;
    // user 発言＋「すくすくが考えています…」の pending バブルを楽観表示する（正本はサーバ）。
    const pendingAssistant: SukuMessage = { role: 'assistant', content: '', status: 'pending' };
    const next: SukuMessage[] = [...messages, userMsg];
    setMessages([...next, pendingAssistant]);
    setInput('');
    setPending([]);
    setError(null);
    setSending(true);
    setStreaming('');
    streamingRef.current = true;

    let acc = '';
    let resolved = false; // done を受け取って表示を確定できたか。
    try {
      const res = await fetch('/api/childcare/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          // サーバは末尾 user テキストに答える。content は空でない値を渡す。
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          media,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalAnswer: string | null = null;
      let finalMedia: SukuMedia[] = [];
      let finalStatus: SukuStatus = 'done';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt: {
            type?: string;
            text?: string;
            answer?: string;
            media?: unknown;
            status?: SukuStatus;
          } = {};
          try {
            evt = JSON.parse(line.slice(6)) as typeof evt;
          } catch {
            continue;
          }
          if (evt.type === 'chunk' && typeof evt.text === 'string') {
            acc += evt.text;
            setStreaming(acc);
          } else if (evt.type === 'done') {
            // done の answer は記法を除去済みの整形本文。media は検証/生成済みのみ確定。
            finalAnswer = typeof evt.answer === 'string' && evt.answer ? evt.answer : acc;
            if (evt.status === 'error') finalStatus = 'error';
            if (Array.isArray(evt.media)) {
              const norm = normalizeMessages([{ role: 'assistant', content: '', media: evt.media }]);
              finalMedia = norm[0]?.media ?? [];
            }
            resolved = true;
          }
        }
      }
      const answer = (finalAnswer ?? acc).trim();
      if (resolved && answer) {
        // 完了を受け取れた → pending バブルを確定本文で置き換える。
        const assistantMsg: SukuMessage = { role: 'assistant', content: answer, status: finalStatus };
        if (finalMedia.length > 0) assistantMsg.media = finalMedia;
        setMessages((prev) => replaceLastPending(prev, assistantMsg));
      } else {
        // done を受け取れずストリームが切れた（接続断・途中終了）。失敗扱いにせず pending を残し、
        // ポーリング／タブ復帰でサーバの確定結果を取りに行く。
        streamingRef.current = false;
        void restore();
      }
    } catch {
      // 通信が確立できなかった／途中で切れた。エラー確定せず pending のまま、サーバ結果を待つ。
      streamingRef.current = false;
      void restore();
    } finally {
      setStreaming(null);
      setSending(false);
      streamingRef.current = false;
    }
  }, [input, pending, sending, messages, restore]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setStreaming(null);
    setPending([]);
    // サーバ側の蓄積も論理クリアする（失敗しても表示はクリア済みのまま）。
    void fetch('/api/childcare/chat/history', { method: 'DELETE' }).catch(() => {
      /* 通信失敗時はローカルのみクリア */
    });
  }, []);

  return {
    messages,
    input,
    setInput,
    sending,
    uploading,
    error,
    pending,
    streaming,
    restore,
    upload,
    removePending,
    send,
    clearHistory,
  };
}

type SukuChat = ReturnType<typeof useSukuChat>;

// ─── 入力バー（テキスト＋メディア添付）。タブ・モーダル共通 ─────────────
function SukuComposer({ chat }: { chat: SukuChat }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canSend = (chat.input.trim().length > 0 || chat.pending.length > 0) && !chat.sending;
  return (
    <div className="border-t border-border px-3 py-3">
      {/* 添付プレビュー（送信前） */}
      {chat.pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {chat.pending.map((m) => (
            <div
              key={m.id}
              className="relative overflow-hidden rounded-md border border-border bg-surface-2"
            >
              {m.kind === 'image' ? (
                <img src={m.url} alt={m.name ?? '添付画像'} className="h-16 w-16 object-cover" />
              ) : (
                <div className="flex h-16 w-16 flex-col items-center justify-center gap-1 px-1 text-center">
                  <span aria-hidden className="text-base">🎬</span>
                  <span className="line-clamp-1 text-[9px] text-text-muted">動画</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => chat.removePending(m.id)}
                aria-label="添付を削除"
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg/80 text-text-muted hover:text-text"
              >
                <CloseIcon width={12} height={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {chat.error && <p className="mb-1.5 px-1 text-[11px] text-blocked">{chat.error}</p>}
      <div className="flex items-end gap-2">
        {/* メディア添付ボタン */}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/heic,video/mp4,video/quicktime,video/webm"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) void chat.upload(files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={chat.uploading || chat.sending}
          aria-label="画像・動画を添付"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          {chat.uploading ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
          ) : (
            <ImageFileIcon width={18} height={18} />
          )}
        </button>
        <textarea
          value={chat.input}
          onChange={(e) => chat.setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter で送信（Shift+Enter で改行）。
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) void chat.send();
            }
          }}
          rows={1}
          placeholder="育児のお悩みを入力…"
          aria-label="メッセージを入力"
          className="max-h-28 min-h-[40px] flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void chat.send()}
          disabled={!canSend}
          aria-label="送信"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendIcon width={18} height={18} />
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-text-faint">{SUKU_SAFETY_NOTE}</p>
    </div>
  );
}

// ─── メッセージ一覧（タブ・モーダル共通） ──────────────────────────────
function SukuMessageList({
  chat,
  scrollRef,
}: {
  chat: SukuChat;
  scrollRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {/* ウェルカム（常に先頭に表示） */}
      <SukuBubble role="assistant">
        <ChatMarkdown body={SUKU_WELCOME} />
      </SukuBubble>
      {chat.messages.map((m, i) => {
        // ストリーミング中は末尾 pending を二重表示しない（streaming バブルが受け持つ）。
        const isLast = i === chat.messages.length - 1;
        if (
          m.role === 'assistant' &&
          m.status === 'pending' &&
          isLast &&
          chat.streaming !== null
        ) {
          return null;
        }
        return (
          <SukuBubble key={i} role={m.role} media={m.media}>
            {m.role === 'assistant' ? (
              m.status === 'pending' ? (
                <SukuThinking />
              ) : (
                <ChatMarkdown body={m.content} />
              )
            ) : (
              <span className="whitespace-pre-wrap break-words">{m.content}</span>
            )}
          </SukuBubble>
        );
      })}
      {chat.streaming !== null && (
        <SukuBubble role="assistant">
          {chat.streaming.length > 0 ? (
            <ChatMarkdown body={chat.streaming} />
          ) : (
            <SukuThinking />
          )}
        </SukuBubble>
      )}
    </div>
  );
}

// ─── 「すくすくが考えています…」インジケータ（pending / ストリーム待ち共通） ──
function SukuThinking() {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-muted">
      <span className="inline-flex items-center gap-1" aria-hidden>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:0.15s]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:0.3s]" />
      </span>
      <span className="text-xs">すくすくが考えています…</span>
    </span>
  );
}

// ─── 育児チャットタブ（チャット UI と履歴が主役の画面） ───────────────
// マウント時にサーバ履歴を復元して時系列表示する。FAB と同じサーバ履歴を共有。
function ChildcareChatTab() {
  const chat = useSukuChat();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // マウント時にサーバ履歴を取り込む（リロード・別端末・再オープンで過去の質問が並ぶ）。
  useEffect(() => {
    void chat.restore();
    // restore は安定参照（useCallback）。初回のみ実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新しいメッセージ・ストリーム更新で最下部へスクロール。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streaming]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"
          >
            <ChildcareChatIcon width={20} height={20} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-text">すくすくに相談</p>
            <p className="truncate text-[11px] text-text-muted">育児専門アドバイザー・過去の相談も残ります</p>
          </div>
        </div>
        {chat.messages.length > 0 && (
          <button
            type="button"
            onClick={chat.clearHistory}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-surface-2 hover:text-text"
          >
            履歴を消去
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg">
        <SukuMessageList chat={chat} scrollRef={(el) => (scrollRef.current = el)} />
        <SukuComposer chat={chat} />
      </div>
    </div>
  );
}

// ─── 育児チャット FAB（他タブからチャットタブへ飛ぶ導線） ──────────────
// FAB はタップで「育児チャット」タブへ遷移する（パネル展開でなくタブへ寄せ、履歴を主役に）。
function ChildcareChatFab({ onOpen, hidden }: { onOpen: () => void; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="育児相談チャット「すくすく」を開く"
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-accent/30 bg-accent text-bg shadow-lg transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:bottom-6 md:right-6"
    >
      <ChildcareChatIcon width={26} height={26} />
    </button>
  );
}

// ─── すくすくチャットの吹き出し ──────────────────────────────────
function SukuBubble({
  role,
  media,
  children,
}: {
  role: SukuRole;
  media?: SukuMedia[];
  children: ReactNode;
}) {
  const isUser = role === 'user';
  // 返信側メディア（YouTube 埋め込み・図解・公式画像）は窮屈にならないよう少し広めの吹き出しにする。
  const hasMedia = !!media && media.length > 0;
  const widthClass = !isUser && hasMedia ? 'max-w-[92%] sm:max-w-[28rem]' : 'max-w-[85%]';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`${widthClass} break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-sm bg-accent text-bg'
            : 'rounded-bl-sm border border-border bg-surface text-text'
        }`}
      >
        {/* 添付メディア。保護者の添付（画像/動画）と、すくすくの返却（YouTube/生成図解/公式画像）。 */}
        {media && media.length > 0 && (
          <div className="mb-1.5 flex flex-col gap-2">
            {media.map((m) => (
              <SukuMediaItem key={m.id} media={m} />
            ))}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ─── すくすくチャットの 1 メディア（画像/動画/YouTube 埋め込み） ──────────
// 種別ごとに描画する。
//   - youtube: youtube-nocookie の iframe 埋め込み（aspect-video）。キャプション・出典を添える。
//   - image  : インライン画像。生成図解/公式画像はキャプション・出典リンクを添える。
//   - video  : 保護者添付の動画（<video>）。
// XSS/安全: iframe は youtube-nocookie ドメイン固定。画像 src は検証済み自前配信 URL か添付 URL のみ。
function SukuMediaItem({ media: m }: { media: SukuMedia }) {
  if (m.kind === 'youtube' && m.videoId) {
    return (
      <figure className="m-0">
        <div className="overflow-hidden rounded-md border border-black/10 bg-black/5">
          <iframe
            className="aspect-video w-full"
            src={`https://www.youtube-nocookie.com/embed/${m.videoId}`}
            title={m.sourceTitle ?? m.caption ?? '参考動画'}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        {(m.caption || m.sourceTitle) && (
          <figcaption className="mt-1 text-[11px] leading-snug text-text-muted">
            {m.caption && <span>{m.caption}</span>}
            {m.sourceUrl && (
              <>
                {m.caption && ' '}
                <a
                  href={m.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-text"
                >
                  {m.sourceTitle ?? 'YouTube で見る'}
                </a>
              </>
            )}
          </figcaption>
        )}
      </figure>
    );
  }

  if (m.kind === 'image') {
    return (
      <figure className="m-0">
        <a href={m.url} target="_blank" rel="noopener noreferrer">
          <img
            src={m.url}
            alt={m.caption ?? m.name ?? (m.source === 'generated' ? '図解' : '画像')}
            loading="lazy"
            className="max-h-72 max-w-full rounded-md border border-black/10 object-contain"
          />
        </a>
        {(m.caption || m.sourceUrl) && (
          <figcaption className="mt-1 text-[11px] leading-snug text-text-muted">
            {m.caption && <span>{m.caption}</span>}
            {m.source === 'web' && m.sourceUrl && (
              <>
                {m.caption && ' '}
                <a
                  href={m.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-text"
                >
                  出典
                </a>
              </>
            )}
          </figcaption>
        )}
      </figure>
    );
  }

  // 動画（保護者添付）。
  return (
    <video
      src={m.url}
      controls
      preload="metadata"
      className="max-h-60 max-w-full rounded-md border border-black/10"
    />
  );
}

type ChildcareTab = 'chat' | 'guide' | 'diary';

/** 初期タブ判定: prop 優先。既定は 'diary'（成長日記）。?tab=guide / ?tab=chat を尊重。 */
function resolveInitialTab(initialTab?: ChildcareTab): ChildcareTab {
  if (initialTab) return initialTab;
  if (typeof window !== 'undefined') {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'guide') return 'guide';
    if (t === 'chat') return 'chat';
  }
  // 育児メニュータップ（/childcare）・/baby-diary とも成長日記を先に出す。
  return 'diary';
}

// ─── タブバー（成長日記 / 育児ガイド / 育児チャット）。下線アクティブ流儀 ──
function ChildcareTabBar({ tab, onChange }: { tab: ChildcareTab; onChange: (t: ChildcareTab) => void }) {
  const tabs: { id: ChildcareTab; label: string; icon: ReactNode }[] = [
    { id: 'diary', label: '成長日記', icon: <DiaryIcon width={16} height={16} /> },
    { id: 'guide', label: '育児ガイド', icon: <BabyIcon width={16} height={16} /> },
    { id: 'chat', label: '育児チャット', icon: <ChildcareChatIcon width={16} height={16} /> },
  ];
  return (
    <div className="flex border-b border-border px-4 md:px-6" role="tablist" aria-label="育児ページのタブ">
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              active
                ? 'border-accent font-semibold text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function Childcare({ initialTab }: { initialTab?: ChildcareTab } = {}) {
  const [tab, setTab] = useState<ChildcareTab>(() => resolveInitialTab(initialTab));

  const changeTab = (next: ChildcareTab) => {
    setTab(next);
    // URL をタブに同期（リロードでタブ維持・履歴は汚さない）。成長日記が既定。
    if (typeof window !== 'undefined') {
      const url =
        next === 'guide' ? '/childcare?tab=guide' : next === 'chat' ? '/childcare?tab=chat' : '/childcare';
      window.history.replaceState(null, '', url);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="育児"
        subtitle="第一子（男の子）の生後経過・手続き・健診の目安、毎日の成長日記、育児相談チャットをまとめます。"
        fetchedAt={undefined}
      />
      <ChildcareTabBar tab={tab} onChange={changeTab} />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {tab === 'guide' ? (
          <ChildcareGuide />
        ) : tab === 'chat' ? (
          <ChildcareChatTab />
        ) : (
          <BabyDiary embedded />
        )}
      </div>
      {/* チャットタブ以外のときだけ FAB を出す（タップで育児チャットタブへ遷移）。 */}
      <ChildcareChatFab hidden={tab === 'chat'} onOpen={() => changeTab('chat')} />
    </div>
  );
}
