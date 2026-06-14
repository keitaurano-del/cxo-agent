// 育児ページ（/childcare, MC-226 Phase1）。
// 第一子（男児）の誕生日を基準に、いま来るもの／成長タイムライン／父親の役割／
// 行政手続き／健診・予防接種を静的 curated データから描画する。
// 医療・制度情報は「目安／要確認」を徹底（断定しない）。AI/RAG 連携は後続フェーズ。
import type { ReactNode } from 'react';
import { PageHeader } from '../components/PageHeader';
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
} from './childcareData';
import type { AdminProcedure, CheckupItem } from './childcareData';

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

// ─── セクション①: いま来るもの ─────────────────────────────
function UpcomingSection({ now }: { now: Date }) {
  // 締切が近い順に上位5件。
  const items = upcomingDueItems(now).slice(0, 5);
  return (
    <section className="rounded-lg border border-accent/40 bg-surface p-4 md:p-5">
      <SectionTitle hint="締切・予定日が近い順。期限超過は「期限注意」、本日〜数日内は強調表示します。">
        いま来るもの（直近の締切・予定）
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

// ─── セクション②: 成長タイムライン ─────────────────────────
function GrowthSection({ now }: { now: Date }) {
  const months = ageInMonths(now);
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="現在の月齢に該当する帯をハイライトしています。">
        成長タイムライン（発達の目安）
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {GROWTH_STAGES.map((stage) => {
          const active =
            months >= stage.fromMonth && (stage.toMonth === null || months < stage.toMonth);
          return (
            <li
              key={stage.label}
              className={`rounded-md border px-3 py-2.5 ${
                active ? 'border-accent/60 bg-accent/10' : 'border-border bg-bg'
              }`}
            >
              <p className={`text-sm font-semibold ${active ? 'text-accent' : 'text-text'}`}>
                {stage.label}
                {active && <span className="ml-2 text-[11px] font-bold text-accent">いまここ</span>}
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed text-text-muted">
                {stage.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <Note>{GROWTH_DISCLAIMER}</Note>
    </section>
  );
}

// ─── セクション③: 父親としてやること ──────────────────────
function FatherSection() {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 md:p-5">
      <SectionTitle hint="産後すぐ〜産褥期に夫が担いたい役割のチェックリストです。">
        父親（夫）としてやること
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
        父親としてのマインドセット
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
        行政手続き（締切付き・先回り）
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
      <SectionTitle hint={BUNKYO_CAPTION}>{RESIDENCE}独自の手続き・サービス</SectionTitle>
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
      <SectionTitle hint={PERKS_CAPTION}>知っておくとお得・特典（役所＋民間）</SectionTitle>

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
        健診・予防接種（先回り）
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

export default function Childcare() {
  // クライアントの現在日を基準に算出（マウント時に固定）。
  const now = new Date();
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="育児"
        subtitle="第一子（男の子）の生後経過と、いま来る手続き・健診・育児の目安をまとめます。"
        fetchedAt={undefined}
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <BabyHeader now={now} />
          <UpcomingSection now={now} />
          <FatherMindsetSection />
          <GrowthSection now={now} />
          <FatherSection />
          <AdminSection now={now} />
          <BunkyoSection />
          <PerksSection />
          <CheckupSection now={now} />
        </div>
      </div>
    </div>
  );
}
