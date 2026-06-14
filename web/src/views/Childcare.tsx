// 育児ページ（/childcare, MC-226 Phase1）。
// 第一子（男児）の誕生日を基準に、いま来るもの／成長タイムライン／父親の役割／
// 行政手続き／健診・予防接種を静的 curated データから描画する。
// 医療・制度情報は「目安／要確認」を徹底（断定しない）。AI/RAG 連携は後続フェーズ。
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '../components/PageHeader';
import { BabyIcon, CloseIcon, DiaryIcon } from '../components/icons';
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

type ChildcareTab = 'guide' | 'diary';

/** 初期タブ判定: prop 優先。既定は 'diary'（成長日記）。?tab=guide のときだけ 'guide'。 */
function resolveInitialTab(initialTab?: ChildcareTab): ChildcareTab {
  if (initialTab) return initialTab;
  if (typeof window !== 'undefined') {
    const { search } = window.location;
    if (new URLSearchParams(search).get('tab') === 'guide') return 'guide';
  }
  // 育児メニュータップ（/childcare）・/baby-diary とも成長日記を先に出す。
  return 'diary';
}

// ─── タブバー（育児ガイド / 成長日記）。既存の下線アクティブ流儀に合わせる ──
function ChildcareTabBar({ tab, onChange }: { tab: ChildcareTab; onChange: (t: ChildcareTab) => void }) {
  // 成長日記を先頭に（育児メニュータップで成長日記が先に来るよう、タブ順も先頭に揃える）。
  const tabs: { id: ChildcareTab; label: string; icon: ReactNode }[] = [
    { id: 'diary', label: '成長日記', icon: <DiaryIcon width={16} height={16} /> },
    { id: 'guide', label: '育児ガイド', icon: <BabyIcon width={16} height={16} /> },
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
    // URL をタブに同期（リロードでタブ維持・履歴は汚さない）。成長日記が既定なので guide だけ ?tab=guide。
    if (typeof window !== 'undefined') {
      const url = next === 'guide' ? '/childcare?tab=guide' : '/childcare';
      window.history.replaceState(null, '', url);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="育児"
        subtitle="第一子（男の子）の生後経過・手続き・健診の目安と、毎日の成長日記をまとめます。"
        fetchedAt={undefined}
      />
      <ChildcareTabBar tab={tab} onChange={changeTab} />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {tab === 'guide' ? <ChildcareGuide /> : <BabyDiary embedded />}
      </div>
    </div>
  );
}
