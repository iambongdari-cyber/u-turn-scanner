import Link from 'next/link';
import { readFile } from 'fs/promises';
import path from 'path';
import { supabase } from '@/lib/supabase';
import SearchForm from './_components/SearchForm';
import {
  getSidecarFileStatuses,
  summarizeSidecarFreshness,
  buildHomeSummary,
  type SidecarFileStatus,
  type SidecarFreshness,
  type HomeSummary,
  type SectorBrief,
} from '@/app/_lib/sidecar';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────
// v0.3-10: change_dump_latest.json 을 직접 읽어 홈에 4 핵심 종목 요약을 표시.
// 사용자 명세대로 app/page.tsx 중심으로만 로직을 둔다 (별도 헬퍼 모듈 신설 없음).
// JSON 구조 변경 0건, /changes 화면과 동일한 필터·정렬 기준 사용.
// ─────────────────────────────────────────────────────────────────────────

interface ChangeRowLite {
  ticker: string;
  name: string | null;
  today_rank: number | null;
  yesterday_rank: number | null;
  rank_delta: number | null;
  today_score: number | null;
  yesterday_score: number | null;
  score_delta: number | null;
  today_sector: string | null;
  today_stage: string | null;   // v0.3-10 보정: "현재단계" 표시용 (예: "바닥 관찰")
  change_type: string;
}

interface ChangeDumpLite {
  status: string;
  today_date: string | null;
  previous_date: string | null;
  yesterday_date: string | null;
  compare_label: string | null;
  changes: ChangeRowLite[];
}

async function loadChangeDumpForHome(): Promise<ChangeDumpLite | null> {
  const filePath = path.join(process.cwd(), 'logs', 'sidecar', 'change_dump_latest.json');
  try {
    const buf = await readFile(filePath, 'utf-8');
    const d = JSON.parse(buf) as ChangeDumpLite;
    return d;
  } catch {
    return null;
  }
}

interface HomeKeyPicks {
  topNew: ChangeRowLite | null;
  topRankUp: ChangeRowLite | null;
  topRankDown: ChangeRowLite | null;
  topScoreUp: ChangeRowLite | null;
}

function pickHomeKeyChanges(rows: ChangeRowLite[] | undefined): HomeKeyPicks {
  if (!rows || rows.length === 0) {
    return { topNew: null, topRankUp: null, topRankDown: null, topScoreUp: null };
  }
  // /changes 의 v0.3-9 기준과 동일하게 선정.
  const newPick = [...rows]
    .filter((r) => r.change_type === 'NEW' && typeof r.today_score === 'number')
    .sort((a, b) => Number(b.today_score) - Number(a.today_score))[0]
    ?? [...rows]
      .filter((r) => r.change_type === 'NEW')
      .sort((a, b) => (a.today_rank ?? 9999) - (b.today_rank ?? 9999))[0]
    ?? null;

  const upPick = [...rows]
    .filter((r) => typeof r.rank_delta === 'number' && (r.rank_delta as number) < 0)
    .sort((a, b) => (a.rank_delta as number) - (b.rank_delta as number))[0]
    ?? null;

  const downPick = [...rows]
    .filter((r) => typeof r.rank_delta === 'number' && (r.rank_delta as number) > 0)
    .sort((a, b) => (b.rank_delta as number) - (a.rank_delta as number))[0]
    ?? null;

  const scoreUpPick = [...rows]
    .filter((r) => typeof r.score_delta === 'number' && (r.score_delta as number) > 0)
    .sort((a, b) => (b.score_delta as number) - (a.score_delta as number))[0]
    ?? null;

  return {
    topNew: newPick ?? null,
    topRankUp: upPick,
    topRankDown: downPick,
    topScoreUp: scoreUpPick,
  };
}

export default async function Home() {
  // 가장 최근 일일 리포트 1건
  const { data: latestDaily } = await supabase
    .from('reports')
    .select('id, base_date')
    .eq('report_type', 'daily')
    .order('base_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 안 읽은 알림 개수
  const { count: unreadCount } = await supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);

  // v0.3-4: 사이드카 파일 최신 상태 (홈 상단 안내 박스용)
  const { scan: scanStatus, sector: sectorStatus } = await getSidecarFileStatuses();
  const freshness = summarizeSidecarFreshness(scanStatus, sectorStatus);

  // v0.3-5: 오늘의 핵심 변화 요약 (사이드카 JSON 집계, 새 키 요구 0건)
  const homeSummary = await buildHomeSummary();

  // v0.3-10: 직전 스냅샷 대비 핵심 종목 4개 (change_dump_latest.json 직접 읽기)
  const changeDump = await loadChangeDumpForHome();
  const keyPicks = pickHomeKeyChanges(changeDump?.changes);

  return (
    <main className="container mx-auto max-w-3xl p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">U턴 스캐너</h1>
        <p className="mt-1 text-sm text-slate-600">
          국내주식 U턴 종목 자동 스캐너 · 분석 보조 도구
        </p>
        <p className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          오늘은 시장 흐름을 먼저 보고, 바닥 U턴 후보와 주도주·후발주를 나눠 확인한 뒤, 키움 참고표와 매매일지로 정리합니다.
        </p>
      </header>

      <SidecarFreshnessBox freshness={freshness} />

      <HomeSummaryCard summary={homeSummary} />

      <ChangeHighlightBox dump={changeDump} picks={keyPicks} />

      <SearchForm defaultDate={latestDaily?.base_date} />

      <div className="mt-6 space-y-4">
        <FlowSection title="1) 오늘 시작" desc="아침에 시장 흐름과 오늘의 후보 등급을 먼저 본다.">
          <FlowLink href="/market" emoji="🗺" label="오늘의 시장 지도" />
          <FlowLink href="/opportunities" emoji="🎯" label="오늘의 기회 포착판" />
        </FlowSection>

        <FlowSection title="2) 후보 점검" desc="바닥 U턴 후보와 주도주·후발주를 나눠 본다.">
          <FlowLink href="/bottom-watch" emoji="🌱" label="바닥 U턴 후보" />
          <FlowLink href="/leaders" emoji="🏆" label="주도주·후발주" />
          <FlowLink href="/changes" emoji="🔄" label="어제 대비 변화" />
        </FlowSection>

        <FlowSection title="3) 입력 참고" desc="키움 자동감시주문에 직접 입력하기 전 참고용 표.">
          <FlowLink href="/kiwoom-helper" emoji="📋" label="키움 자동감시 참고표" />
        </FlowSection>

        <FlowSection title="4) 복기" desc="관찰·복기 보조용 일지 초안.">
          <FlowLink href="/journal" emoji="📝" label="매매일지 초안" />
        </FlowSection>

        <FlowSection title="5) 기존 기능" desc="리포트 · 백테스트 · 알림 · 과거 자료.">
          {latestDaily ? (
            <FlowLink
              href={`/reports/${latestDaily.id}`}
              emoji="▶"
              label={`가장 최근 일일 리포트 (${latestDaily.base_date})`}
            />
          ) : (
            <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500">
              아직 일일 리포트가 없습니다.
            </span>
          )}
          <FlowLink href="/history" emoji="📅" label="과거 리포트 전체 보기" />
          <FlowLink href="/backtest" emoji="📊" label="백테스트 결과" />
          <AlertLink unreadCount={unreadCount} />
        </FlowSection>
      </div>
    </main>
  );
}

function FlowSection({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {desc && <p className="mt-0.5 text-xs text-slate-500">{desc}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function FlowLink({
  href,
  emoji,
  label,
}: {
  href: string;
  emoji: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
    >
      <span aria-hidden>{emoji}</span>
      <span>{label}</span>
    </Link>
  );
}

function AlertLink({ unreadCount }: { unreadCount: number | null | undefined }) {
  return (
    <Link
      href="/alerts"
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
    >
      <span aria-hidden>🔔</span>
      <span>알림</span>
      {unreadCount != null && unreadCount > 0 && (
        <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}

// v0.3-4: 사이드카 최신 상태 안내 박스
function SidecarFreshnessBox({ freshness }: { freshness: SidecarFreshness }) {
  const { bannerLevel, headline, detail, scan, sector, needsRerun } = freshness;
  const wrapCls =
    bannerLevel === 'error'
      ? 'border-red-300 bg-red-50'
      : bannerLevel === 'warn'
      ? 'border-amber-300 bg-amber-50'
      : 'border-emerald-200 bg-emerald-50';
  const headCls =
    bannerLevel === 'error'
      ? 'text-red-900'
      : bannerLevel === 'warn'
      ? 'text-amber-900'
      : 'text-emerald-900';
  const iconText = bannerLevel === 'error' ? '❌' : bannerLevel === 'warn' ? '⚠️' : '✅';

  return (
    <section className={`mb-4 rounded-md border p-3 shadow-sm ${wrapCls}`}>
      <div className={`flex flex-wrap items-baseline gap-2 ${headCls}`}>
        <span className="text-sm font-semibold">
          {iconText} 사이드카 최신 상태
        </span>
        <span className="text-xs font-normal">— {headline}</span>
      </div>
      <p className={`mt-1 text-[11px] ${headCls.replace('900', '800')}`}>
        {detail}
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SidecarStatusRow s={scan} />
        <SidecarStatusRow s={sector} />
      </div>
      {needsRerun && (
        <p className={`mt-2 rounded border px-2 py-1 text-[11px] ${
          bannerLevel === 'error'
            ? 'border-red-200 bg-white text-red-800'
            : 'border-amber-200 bg-white text-amber-800'
        }`}>
          👉 <strong>run_daily.bat</strong> 재실행 후 다시 확인하세요. (사이드카 단독 재생성은 <strong>run_sidecar.bat</strong>도 가능)
        </p>
      )}
      <p className={`mt-1 text-[10px] ${headCls.replace('900', '700')}`}>
        이 박스는 분석 결과가 아니라 데이터 최신성 확인용입니다.
      </p>
    </section>
  );
}

function SidecarStatusRow({ s }: { s: SidecarFileStatus }) {
  const kindLabel = s.kind === 'scan' ? '바닥 후보 사이드카' : '섹터 사이드카';
  const tone =
    s.status === 'ok'
      ? 'border-emerald-200 bg-white text-emerald-900'
      : s.status === 'stale'
      ? 'border-amber-200 bg-white text-amber-900'
      : 'border-red-200 bg-white text-red-900';
  const badge =
    s.status === 'ok'
      ? { text: '오늘 최신', cls: 'bg-emerald-100 text-emerald-800' }
      : s.status === 'stale'
      ? { text: '오래된 파일', cls: 'bg-amber-100 text-amber-800' }
      : s.status === 'error'
      ? { text: '읽기 실패', cls: 'bg-red-100 text-red-800' }
      : { text: '파일 없음', cls: 'bg-red-100 text-red-800' };
  return (
    <div className={`rounded border p-2 text-[11px] ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <span className="font-medium">{kindLabel}</span>
        <span className={`inline-flex rounded px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.text}</span>
      </div>
      <div className="mt-0.5 text-slate-600">
        <code className="rounded bg-slate-100 px-1 text-[10px] text-slate-700">{s.pathLabel}</code>
      </div>
      {s.modifiedAtIso && (
        <div className="mt-0.5 text-slate-600">생성 {s.modifiedAtIso}{s.ageHours != null && <> · {s.ageHours}시간 경과</>}</div>
      )}
      {(s.status === 'missing' || s.status === 'error' || s.status === 'stale') && (
        <div className="mt-1 text-slate-700">{s.message}</div>
      )}
    </div>
  );
}

// v0.3-5: 오늘의 핵심 변화 요약 카드
function HomeSummaryCard({ summary }: { summary: HomeSummary }) {
  // 사이드카가 둘 다 없으면 안내만
  if (!summary.hasAny) {
    return (
      <section className="mb-4 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">오늘의 핵심 변화 요약</h2>
        <p className="mt-1 text-xs text-slate-500">
          오늘의 핵심 변화 요약을 생성할 수 없습니다. 사이드카 데이터가 없으니 위의 상태 박스를 확인하고 <strong>run_daily.bat</strong> 실행 후 다시 보세요.
        </p>
        <p className="mt-1 text-[10px] text-slate-400">
          이 영역은 분석 결과가 아니라 데이터 요약 표시입니다. 투자 판단은 사용자가 직접 합니다.
        </p>
      </section>
    );
  }

  const { counts, strongSectorsTop3, weakSectorsTop3, bullets, baseDate, marketFlow } = summary;
  const flowCls =
    marketFlow === '강세 흐름' ? 'bg-green-100 text-green-800' :
    marketFlow === '약세 흐름' ? 'bg-red-100 text-red-800' :
    'bg-slate-200 text-slate-700';

  return (
    <section className="mb-4 rounded-md border border-indigo-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-indigo-900">오늘의 핵심 변화 요약</h2>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
          {baseDate && <span>기준일 {baseDate}</span>}
          {marketFlow && (
            <span className="inline-flex items-center gap-1">
              시장 흐름
              <span className={`rounded px-2 py-0.5 ${flowCls}`}>{marketFlow}</span>
            </span>
          )}
        </div>
      </div>

      {/* 카운트 4칸 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryNum label="오늘 U턴 후보" value={counts.bottomCandidates} tone="emerald" />
        <SummaryNum label="U턴 확인" value={counts.uTurnConfirmed} tone="indigo" />
        <SummaryNum label="추격 위험" value={counts.chaseRiskStrong} tone="orange" />
        <SummaryNum label="뉴스 위험 (바닥)" value={counts.criticalInBottom} tone="red" />
      </div>

      {/* 강한/약한 섹터 TOP3 */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SectorList title="강한 섹터 TOP3" sectors={strongSectorsTop3} variant="strong" />
        <SectorList title="약한 섹터 TOP3" sectors={weakSectorsTop3} variant="weak" />
      </div>

      {/* 오늘 다시 볼 포인트 */}
      <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2">
        <p className="mb-1 text-xs font-semibold text-slate-700">오늘 다시 볼 포인트</p>
        <ul className="space-y-0.5 text-[12px] text-slate-700">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-1">
              <span className="text-slate-400">·</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 부재 안내 */}
      {(!summary.hasScan || !summary.hasSector) && (
        <p className="mt-2 text-[11px] text-amber-700">
          {!summary.hasScan && !summary.hasSector
            ? '사이드카 두 파일 모두 부재 — 요약이 비어 있습니다.'
            : !summary.hasScan
              ? 'scan_dump 부재 — 바닥/U턴 카운트는 비어 있습니다.'
              : 'sector_dump 부재 — 강한/약한 섹터는 비어 있습니다.'}
        </p>
      )}

      <p className="mt-2 text-[10px] text-slate-400">
        이 카드는 분석 결과가 아니라 사이드카 집계 요약입니다. 어떤 표시도 매매 권유가 아니며, 투자 판단은 사용자가 직접 합니다.
      </p>
    </section>
  );
}

function SummaryNum({
  label, value, tone,
}: { label: string; value: number; tone: 'emerald' | 'indigo' | 'orange' | 'red' }) {
  const cls =
    tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' :
    tone === 'indigo' ? 'border-indigo-200 bg-indigo-50 text-indigo-900' :
    tone === 'orange' ? 'border-orange-200 bg-orange-50 text-orange-900' :
                        'border-red-200 bg-red-50 text-red-900';
  return (
    <div className={`rounded border p-2 ${cls}`}>
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function SectorList({
  title, sectors, variant,
}: { title: string; sectors: SectorBrief[]; variant: 'strong' | 'weak' }) {
  const headCls = variant === 'strong' ? 'text-emerald-800' : 'text-orange-800';
  const itemCls = variant === 'strong'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : 'border-orange-200 bg-orange-50 text-orange-900';
  return (
    <div>
      <p className={`mb-1 text-xs font-semibold ${headCls}`}>{title}</p>
      {sectors.length === 0 ? (
        <p className="text-[11px] text-slate-500">데이터 없음 — sector_dump 확인 필요.</p>
      ) : (
        <ul className="space-y-1">
          {sectors.map((s, i) => (
            <li key={`${s.name}-${i}`} className={`flex items-baseline justify-between rounded border px-2 py-1 text-[12px] ${itemCls}`}>
              <span className="font-medium">{s.name}</span>
              <span className="text-[10px] tabular-nums opacity-90">
                {s.return20d != null && <>20일 {s.return20d > 0 ? '+' : ''}{Number(s.return20d).toFixed(1)}%</>}
                {s.relStrength != null && <> · 상대 {s.relStrength > 0 ? '+' : ''}{Number(s.relStrength).toFixed(1)}%</>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// v0.3-10: 홈 "오늘의 변화 핵심 요약" 박스
// /changes 의 v0.3-9 핵심 카드와 동일한 기준으로 4 종목을 1줄씩만 보여준다.
// 박스 안에 /changes 이동 버튼 포함. graceful 처리.
// ─────────────────────────────────────────────────────────────────────────

function fmtRankSimple(n: number | null | undefined): string {
  return n == null ? '-' : String(n);
}
function fmtScoreSimple(n: number | null | undefined): string {
  if (n == null) return '-';
  return Number(n).toFixed(1);
}

function ChangeHighlightBox({
  dump, picks,
}: { dump: ChangeDumpLite | null; picks: HomeKeyPicks }) {
  // 데이터 자체가 없거나 비교 실패 / 부족 시
  if (!dump || dump.status !== 'ok') {
    return (
      <section className="mb-4 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">오늘의 변화 핵심 요약</h2>
          <Link
            href="/changes"
            className="text-[11px] text-blue-600 hover:underline"
          >
            어제 대비 변화 자세히 보기 →
          </Link>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          어제 대비 변화 데이터가 아직 없습니다. <code className="rounded bg-slate-100 px-1">scripts/compare_snapshots.py</code> 실행 후 다시 확인하세요.
        </p>
        <p className="mt-1 text-[10px] text-slate-400">
          이 박스는 분석 결과가 아니라 직전 스냅샷 대비 변화 요약입니다. 매매 권유가 아닙니다.
        </p>
      </section>
    );
  }

  const compareLabel = dump.compare_label
    ?? (dump.today_date && (dump.previous_date ?? dump.yesterday_date)
      ? `${dump.today_date} vs ${dump.previous_date ?? dump.yesterday_date}`
      : (dump.today_date ?? '-'));

  // 모든 픽이 null이면 화면이 너무 비어 보이지만, 카드는 그대로 표시(레이아웃 일관성).
  const allEmpty =
    !picks.topNew && !picks.topRankUp && !picks.topRankDown && !picks.topScoreUp;

  return (
    <section className="mb-4 rounded-md border border-indigo-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="text-sm font-semibold text-indigo-900">오늘의 변화 핵심 요약</h2>
          <span className="text-[11px] text-slate-500">
            비교 기준 <span className="tabular-nums text-slate-700">{compareLabel}</span>
          </span>
        </div>
        <Link
          href="/changes"
          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-800 hover:bg-indigo-100"
        >
          어제 대비 변화 자세히 보기 →
        </Link>
      </div>

      {allEmpty ? (
        <p className="text-xs text-slate-500">오늘 두드러진 변화가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MiniHighlight
            label="대표 신규진입"
            icon="🆕"
            tone="emerald"
            row={picks.topNew}
            metric={
              picks.topNew?.today_score != null
                ? `현재 점수 ${fmtScoreSimple(picks.topNew.today_score)}`
                : (picks.topNew?.today_rank != null ? `현재 순위 ${fmtRankSimple(picks.topNew.today_rank)}` : '')
            }
          />
          <MiniHighlight
            label="최대 순위상승"
            icon="⬆"
            tone="sky"
            row={picks.topRankUp}
            metric={
              picks.topRankUp?.rank_delta != null
                ? `${fmtRankSimple(picks.topRankUp.yesterday_rank)} → ${fmtRankSimple(picks.topRankUp.today_rank)} · ▲${Math.abs(picks.topRankUp.rank_delta)}`
                : ''
            }
          />
          <MiniHighlight
            label="최대 순위하락"
            icon="⬇"
            tone="amber"
            row={picks.topRankDown}
            metric={
              picks.topRankDown?.rank_delta != null
                ? `${fmtRankSimple(picks.topRankDown.yesterday_rank)} → ${fmtRankSimple(picks.topRankDown.today_rank)} · ▼+${picks.topRankDown.rank_delta}`
                : ''
            }
          />
          <MiniHighlight
            label="최대 점수상승"
            icon="📈"
            tone="indigo"
            row={picks.topScoreUp}
            metric={
              picks.topScoreUp?.score_delta != null
                ? `${fmtScoreSimple(picks.topScoreUp.yesterday_score)} → ${fmtScoreSimple(picks.topScoreUp.today_score)} · +${Number(picks.topScoreUp.score_delta).toFixed(1)}`
                : ''
            }
          />
        </div>
      )}

      <p className="mt-2 text-[10px] text-slate-400">
        직전 스냅샷 대비 핵심 종목 4건만 추린 보조 표시입니다. ‘상승/하락’은 가격이 아니라 스캐너 내 후보 순위·점수의 변화입니다. 매매 권유가 아닙니다.
      </p>
    </section>
  );
}

function MiniHighlight({
  label, icon, tone, row, metric,
}: {
  label: string;
  icon: string;
  tone: 'emerald' | 'sky' | 'amber' | 'indigo';
  row: ChangeRowLite | null;
  metric: string;
}) {
  const toneCls =
    tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' :
    tone === 'sky' ? 'border-sky-200 bg-sky-50 text-sky-900' :
    tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' :
                       'border-indigo-200 bg-indigo-50 text-indigo-900';
  return (
    <div className={`rounded border p-2 ${toneCls}`}>
      <div className="text-[10px] font-medium opacity-80">
        {icon} {label}
      </div>
      {row == null ? (
        <div className="mt-1 text-xs text-slate-500">해당 없음</div>
      ) : (
        <>
          <Link
            href={`/stocks/${row.ticker}`}
            className="mt-0.5 block text-sm font-semibold text-slate-800 hover:underline"
          >
            {row.name ?? row.ticker}
            <span className="ml-1 text-[10px] font-normal text-slate-400">{row.ticker}</span>
          </Link>
          {metric && (
            <div className="mt-0.5 text-[11px] tabular-nums text-slate-600">{metric}</div>
          )}
          {row.today_stage && (
            <div className="mt-0.5 text-[11px] text-slate-600">
              <span className="text-slate-500">현재단계</span>{' '}
              <span className="font-medium text-slate-800">{row.today_stage}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
