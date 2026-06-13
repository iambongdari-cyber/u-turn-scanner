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
  today_stage: string | null;        // v0.3-10 보정: "현재단계" 표시용 (예: "바닥 관찰")
  yesterday_stage: string | null;    // v0.3-14: DEPARTED 카드용 — 오늘 빠진 종목은 today_stage=null이라 직전단계 표시
  change_type: string;
}

interface ChangeDumpLite {
  status: string;
  today_date: string | null;
  previous_date: string | null;
  yesterday_date: string | null;
  compare_label: string | null;
  // v0.3-17: 한 줄 요약 박스에서 사용할 카운트 (compare_snapshots.py v0.3-7부터 존재하는 키만 노출 — 새 키 요구 0건)
  summary?: {
    n_new_entries?: number;
    n_departed?: number;
    n_rank_up?: number;
    n_rank_down?: number;
    n_score_up?: number;
    n_score_down?: number;
    n_sector_changed?: number;
    n_total_changes?: number;
  };
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

// ─────────────────────────────────────────────────────────────────────────
// v0.3-19: 판단 보조 카드 — scan_dump_latest.json 추가 fetch
// candidates_bottom 의 ticker 별 disparity_pct 등을 활용해 "제외 검토" 판정을 정밀화.
// fetch 실패 시 안전하게 null 반환 (전체 화면 중단 금지).
// JSON 구조 변경 0건 — 기존 사이드카가 v0.2-1부터 제공하는 키만 사용.
// ─────────────────────────────────────────────────────────────────────────

interface ScanCandidateLite {
  ticker: string;
  close?: number | null;
  ma60?: number | null;
  disparity_pct?: number | null;
  days_below_ma60_60d?: number | null;
}

interface ScanDumpLite {
  candidates_bottom?: ScanCandidateLite[];
}

async function loadScanDumpForJudge(): Promise<Map<string, ScanCandidateLite> | null> {
  const filePath = path.join(process.cwd(), 'logs', 'sidecar', 'scan_dump_latest.json');
  try {
    const buf = await readFile(filePath, 'utf-8');
    const d = JSON.parse(buf) as ScanDumpLite;
    const map = new Map<string, ScanCandidateLite>();
    for (const r of (d.candidates_bottom ?? [])) {
      if (r && typeof r.ticker === 'string') {
        map.set(r.ticker, r);
      }
    }
    return map;
  } catch {
    // fetch/parse 실패해도 전체 화면 중단 금지 — null 반환 → change_dump 만으로 판정 진행
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// v0.3-19: 판정 4단계 — 사용자 명세 표현 그대로
// '개선중' / '유지중' / '약화중' / '제외 검토'
// 보호 원칙: UI 레이어 + 계산 보조 로직만 추가, sidecar JSON 무변경.
// ─────────────────────────────────────────────────────────────────────────

type Judgement = 'IMPROVING' | 'KEEPING' | 'WEAKENING' | 'EXCLUDE_REVIEW';

const JUDGEMENT_ORDER: Record<Judgement, number> = {
  IMPROVING: 0,
  KEEPING: 1,
  WEAKENING: 2,
  EXCLUDE_REVIEW: 3,
};

const JUDGEMENT_LABEL: Record<Judgement, string> = {
  IMPROVING: '개선중',
  KEEPING: '유지중',
  WEAKENING: '약화중',
  EXCLUDE_REVIEW: '제외 검토',
};

const JUDGEMENT_ICON: Record<Judgement, string> = {
  IMPROVING: '🟢',
  KEEPING: '🔵',
  WEAKENING: '🟡',
  EXCLUDE_REVIEW: '🔴',
};

function judgeRow(
  row: ChangeRowLite,
  scanLookup: Map<string, ScanCandidateLite> | null,
): Judgement {
  // 1) 제외 검토 우선 — 가장 강한 부정 신호
  if (row.change_type === 'DEPARTED') return 'EXCLUDE_REVIEW';
  if (row.today_rank == null && row.yesterday_rank != null) return 'EXCLUDE_REVIEW';

  // scan_dump 보강 — disparity_pct < 0 (60일선 이탈)이면 제외 검토 우선
  const scan = scanLookup?.get(row.ticker);
  if (scan && typeof scan.disparity_pct === 'number' && scan.disparity_pct < 0) {
    return 'EXCLUDE_REVIEW';
  }

  // 2) 개선중 — 양쪽 모두 좋음 (점수 상승 + 순위 개선 동시)
  const scoreUp = typeof row.score_delta === 'number' && row.score_delta > 0;
  const rankUp = typeof row.rank_delta === 'number' && row.rank_delta < 0;
  if (scoreUp && rankUp) return 'IMPROVING';

  // 3) 약화중 — 한쪽이라도 명확히 악화
  const SCORE_NEG = -0.5;  // 작은 변동은 노이즈로 간주
  const scoreDown = typeof row.score_delta === 'number' && row.score_delta <= SCORE_NEG;
  const rankDown = typeof row.rank_delta === 'number' && row.rank_delta > 0;
  if (scoreDown || rankDown) return 'WEAKENING';

  // 4) 그 외 — 유지중
  return 'KEEPING';
}

function buildChangeNote(row: ChangeRowLite): string {
  // 어제 대비 변화 자연 문구 (관찰 보조 표현만)
  const parts: string[] = [];
  if (typeof row.rank_delta === 'number') {
    if (row.rank_delta < 0) {
      parts.push(`순위 ▲${Math.abs(row.rank_delta)}계단`);
    } else if (row.rank_delta > 0) {
      parts.push(`순위 ▼${row.rank_delta}계단`);
    } else {
      parts.push('순위 변동 없음');
    }
  } else if (row.today_rank != null && row.yesterday_rank == null) {
    parts.push('신규 후보 진입');
  } else if (row.today_rank == null && row.yesterday_rank != null) {
    parts.push(`후보권 이탈 (직전 ${row.yesterday_rank}위)`);
  } else if (row.today_rank == null) {
    parts.push('순위 정보 없음');
  }

  if (typeof row.score_delta === 'number') {
    const sd = Number(row.score_delta);
    if (sd > 0) parts.push(`점수 +${sd.toFixed(1)}`);
    else if (sd < 0) parts.push(`점수 ${sd.toFixed(1)}`);
    else parts.push('점수 변동 없음');
  }

  return parts.length > 0 ? parts.join(' / ') : '변화 정보 없음';
}

function buildJudgementNote(j: Judgement, row: ChangeRowLite): string {
  // 판정 한 줄 설명 — 관찰 보조 표현만, 매수/매도 권유 0건
  switch (j) {
    case 'IMPROVING':
      return '순위·점수 모두 개선 — 관심 강화 신호로 다시 확인할 후보.';
    case 'KEEPING':
      return '변화가 크지 않거나 한쪽만 개선 — 기존 관찰 흐름 유지 권장.';
    case 'WEAKENING': {
      const partsHint: string[] = [];
      if (typeof row.rank_delta === 'number' && row.rank_delta > 0) partsHint.push('순위 악화');
      if (typeof row.score_delta === 'number' && row.score_delta <= -0.5) partsHint.push('점수 하락');
      const reason = partsHint.length > 0 ? partsHint.join(' · ') : '한쪽 지표 약화';
      return `${reason} — 추가 확인 필요 (매도 권유 아님, 복기 보조).`;
    }
    case 'EXCLUDE_REVIEW':
      if (row.change_type === 'DEPARTED') {
        return '오늘 후보권에서 이탈 — 제외 여부 다시 점검 (매도 권유 아님).';
      }
      if (row.today_rank == null) {
        return '오늘 후보권 외 — 관찰 우선순위에서 한 단계 내릴지 검토.';
      }
      return '60일선 이탈 신호 (disparity 음수) — 제외 검토 필요.';
  }
}

interface HomeKeyPicks {
  topNew: ChangeRowLite | null;
  topRankUp: ChangeRowLite | null;
  topRankDown: ChangeRowLite | null;
  topScoreUp: ChangeRowLite | null;
  topDeparted: ChangeRowLite | null;   // v0.3-14: 대표 이탈 (yesterday_rank 오름차순)
}

function pickHomeKeyChanges(rows: ChangeRowLite[] | undefined): HomeKeyPicks {
  if (!rows || rows.length === 0) {
    return { topNew: null, topRankUp: null, topRankDown: null, topScoreUp: null, topDeparted: null };
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

  // v0.3-14: 대표 이탈 — DEPARTED 중 yesterday_rank 가 가장 작은(=직전 가장 높은 순위) 종목
  const departedPick = [...rows]
    .filter((r) => r.change_type === 'DEPARTED' && typeof r.yesterday_rank === 'number')
    .sort((a, b) => (a.yesterday_rank as number) - (b.yesterday_rank as number))[0]
    ?? null;

  return {
    topNew: newPick ?? null,
    topRankUp: upPick,
    topRankDown: downPick,
    topScoreUp: scoreUpPick,
    topDeparted: departedPick,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// v0.3-15: "오늘 다시 볼 후보" 3 카드 픽
// ① 강세 지속 — TOP10 유지 + 점수 상승 (score_delta 내림차순)
// ② 다방면 개선 — 순위 상승 + 점수 상승 동시 (rank_delta 오름차순 + score_delta 보조)
// ③ U턴 시도 강화 — today_stage='U턴 시도' + score_delta>0 (score_delta 내림차순)
// 중복 회피: ① → ② → ③ 순서대로 선택, 이미 사용된 ticker 는 다음 후보에서 제외.
// ─────────────────────────────────────────────────────────────────────────

interface HomeSecondLookPicks {
  topConsistent: ChangeRowLite | null;   // ① 강세 지속
  topMomentum: ChangeRowLite | null;     // ② 다방면 개선
  topUTurnStrong: ChangeRowLite | null;  // ③ U턴 시도 강화
}

function pickHomeSecondLook(
  rows: ChangeRowLite[] | undefined,
  excludeTickers: Set<string> = new Set(),  // v0.3-16: 5 카드에 이미 노출된 ticker 들을 미리 제외
): HomeSecondLookPicks {
  if (!rows || rows.length === 0) {
    return { topConsistent: null, topMomentum: null, topUTurnStrong: null };
  }

  // ① TOP10 유지 + 점수 상승 (v0.3-16: excludeTickers 미리 제외)
  const consistent = [...rows]
    .filter((r) =>
      !excludeTickers.has(r.ticker)
      && typeof r.today_rank === 'number' && (r.today_rank as number) <= 10
      && typeof r.score_delta === 'number' && (r.score_delta as number) > 0,
    )
    .sort((a, b) => (b.score_delta as number) - (a.score_delta as number))[0]
    ?? null;

  // v0.3-16: used 초기값 = excludeTickers (5 카드 + 내부 회피 누적)
  const used = new Set<string>(excludeTickers);
  if (consistent) used.add(consistent.ticker);

  // ② 순위 상승 + 점수 상승 동시 (rank_delta 가장 음수 + score_delta 보조)
  const momentum = [...rows]
    .filter((r) =>
      !used.has(r.ticker)
      && typeof r.rank_delta === 'number' && (r.rank_delta as number) < 0
      && typeof r.score_delta === 'number' && (r.score_delta as number) > 0,
    )
    .sort((a, b) => {
      const ra = a.rank_delta as number;
      const rb = b.rank_delta as number;
      if (ra !== rb) return ra - rb;
      return (b.score_delta as number) - (a.score_delta as number);
    })[0]
    ?? null;
  if (momentum) used.add(momentum.ticker);

  // ③ U턴 시도 + 점수 상승
  const uturn = [...rows]
    .filter((r) =>
      !used.has(r.ticker)
      && r.today_stage === 'U턴 시도'
      && typeof r.score_delta === 'number' && (r.score_delta as number) > 0,
    )
    .sort((a, b) => (b.score_delta as number) - (a.score_delta as number))[0]
    ?? null;

  return {
    topConsistent: consistent,
    topMomentum: momentum,
    topUTurnStrong: uturn,
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

  // v0.3-16: 5 카드에 이미 노출된 종목 ticker 5개를 모아 excludeTickers 로 만든다.
  // → 3 카드 픽에서 미리 제외해 같은 종목이 두 영역에 동시 노출되는 것을 막는다.
  const excludeTickers = new Set<string>(
    [
      keyPicks.topNew?.ticker,
      keyPicks.topRankUp?.ticker,
      keyPicks.topRankDown?.ticker,
      keyPicks.topScoreUp?.ticker,
      keyPicks.topDeparted?.ticker,
    ].filter((t): t is string => !!t),
  );

  // v0.3-15: "오늘 다시 볼 후보" 3 카드 픽 (확인 우선순위 참고용)
  // v0.3-16: excludeTickers 를 미리 제외 (5 카드와 다른 종목으로 후보 선정)
  const secondLookPicks = pickHomeSecondLook(changeDump?.changes, excludeTickers);

  // v0.3-19: scan_dump_latest.json 추가 fetch — disparity_pct < 0 (60일선 이탈) 보강용.
  // fetch 실패해도 null 반환 → change_dump 만으로 판정 진행 (전체 화면 중단 금지).
  const scanLookup = await loadScanDumpForJudge();

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

      {/* v0.3-17: 첫 화면에서 핵심 정보를 한눈에 — 카운트 5 + 강한 후보 + 기준일 */}
      <TodaySummaryLineBox dump={changeDump} secondLookPicks={secondLookPicks} />

      <HomeSummaryCard summary={homeSummary} />

      <ChangeHighlightBox dump={changeDump} picks={keyPicks} />

      <SecondLookSection dump={changeDump} picks={secondLookPicks} scanLookup={scanLookup} />

      <SearchForm defaultDate={latestDaily?.base_date} />

      <div className="mt-6 space-y-4">
        <FlowSection title="0) 오늘의 투자판단" desc="퇴근 후 10분, 오늘 볼 종목과 해야 할 행동을 한 화면에 정리합니다 (v0.4).">
          <FlowLink href="/beginner" emoji="📊" label="오늘의 투자판단" />
        </FlowSection>

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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
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
            reason="신규진입 종목 중 최고 점수"
            detailHref="/changes?focus=new"
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
            reason="후보 순위 개선폭 1위"
            detailHref="/changes?focus=up"
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
            reason="후보 순위 하락폭 1위"
            detailHref="/changes?focus=down"
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
            reason="스캐너 점수 상승폭 1위"
            detailHref="/changes?focus=score"
          />
          {/* v0.3-14: 대표 이탈 — yesterday_rank 오름차순 첫 항목 */}
          <MiniHighlight
            label="대표 이탈"
            icon="🚪"
            tone="slate"
            row={picks.topDeparted}
            metric={
              picks.topDeparted?.yesterday_rank != null
                ? `직전 순위 ${fmtRankSimple(picks.topDeparted.yesterday_rank)}${
                    picks.topDeparted?.yesterday_score != null
                      ? ` · 직전 점수 ${fmtScoreSimple(picks.topDeparted.yesterday_score)}`
                      : ''
                  }`
                : ''
            }
            reason="직전 스냅샷에서 가장 높은 순위였던 종목"
            detailHref="/changes?focus=out"
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
  label, icon, tone, row, metric, reason, detailHref,
}: {
  label: string;
  icon: string;
  tone: 'emerald' | 'sky' | 'amber' | 'indigo' | 'slate';  // v0.3-14: 'slate' 톤 추가 (DEPARTED 카드용)
  row: ChangeRowLite | null;
  metric: string;
  reason: string;   // v0.3-11: "선정 이유" 카드 하단 한 줄 (row 있을 때만 노출)
  detailHref: string; // v0.3-12: 카드 헤더 클릭 시 /changes?focus=... 이동
}) {
  const toneCls =
    tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' :
    tone === 'sky' ? 'border-sky-200 bg-sky-50 text-sky-900' :
    tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' :
    tone === 'slate' ? 'border-slate-300 bg-slate-50 text-slate-800' :
                       'border-indigo-200 bg-indigo-50 text-indigo-900';
  return (
    <div className={`rounded border p-2 ${toneCls}`}>
      {/* v0.3-12: 카드 헤더(아이콘 + 라벨) 자체를 /changes?focus=... 로 가는 Link로 만든다.
          종목명 Link 와 nesting 안 되도록 카드 헤더만 Link 처리. */}
      <Link
        href={detailHref}
        className="flex items-center justify-between gap-1 text-[10px] font-medium opacity-80 hover:underline hover:opacity-100"
        title="자세히 보기 → /changes"
      >
        <span>{icon} {label}</span>
        <span className="text-[10px] opacity-70" aria-hidden>→</span>
      </Link>
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
          {/* v0.3-14: today_stage 있으면 "현재단계", 없고 yesterday_stage 있으면 "직전단계" 자동 분기 (DEPARTED 카드용) */}
          {(row.today_stage || row.yesterday_stage) && (
            <div className="mt-0.5 text-[11px] text-slate-600">
              <span className="text-slate-500">{row.today_stage ? '현재단계' : '직전단계'}</span>{' '}
              <span className="font-medium text-slate-800">{row.today_stage ?? row.yesterday_stage}</span>
            </div>
          )}
          {reason && (
            <div className="mt-1 text-[10px] leading-snug text-slate-500">
              선정 이유: {reason}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// v0.3-15: "오늘 다시 볼 후보" 영역
// 5 카드 박스 바로 아래에 세로 1열 3 카드.
// 매수 추천이 아니라 "확인 우선순위 참고용"임을 명확히 한다.
// /changes?focus=... 인프라 (v0.3-12/13)를 그대로 활용해 변화 자세히 보기 링크 제공.
// ─────────────────────────────────────────────────────────────────────────

function SecondLookSection({
  dump, picks, scanLookup,
}: {
  dump: ChangeDumpLite | null;
  picks: HomeSecondLookPicks;
  scanLookup: Map<string, ScanCandidateLite> | null;   // v0.3-19: 판정 보강용
}) {
  // change_dump 자체가 부재이거나 status 정상이 아니면 본 영역은 표시하지 않는다
  // (홈 박스 v0.3-10/14가 이미 안내를 처리).
  if (!dump || dump.status !== 'ok') return null;

  // 3 카드 모두 비어 있으면 영역 자체를 숨긴다 — 사용자 시선 분산 방지.
  const allEmpty =
    !picks.topConsistent && !picks.topMomentum && !picks.topUTurnStrong;
  if (allEmpty) return null;

  // v0.3-19: 3 카드 메타 정의 + 판정 계산
  type CardSpec = {
    order: string;
    label: string;
    tone: 'emerald' | 'sky' | 'indigo';
    row: ChangeRowLite | null;
    reason: string;
    metricKind: 'CONSISTENT' | 'MOMENTUM' | 'UTURN';
    detailHref: string;
  };
  const specs: CardSpec[] = [
    {
      order: '①',
      label: '강세 지속',
      tone: 'emerald',
      row: picks.topConsistent,
      reason: '이미 상위권인데 점수가 더 오른 종목 — 강세 지속을 다시 확인할 후보입니다.',
      metricKind: 'CONSISTENT',
      detailHref: '/changes?focus=score',
    },
    {
      order: '②',
      label: '다방면 개선',
      tone: 'sky',
      row: picks.topMomentum,
      reason: '순위와 점수가 함께 개선된 종목 — 다방면 신호 정렬, 다시 볼 후보입니다.',
      metricKind: 'MOMENTUM',
      detailHref: '/changes?focus=up',
    },
    {
      order: '③',
      label: 'U턴 시도 강화',
      tone: 'indigo',
      row: picks.topUTurnStrong,
      reason: 'U턴 시도 단계 + 직전 대비 점수 상승 — 단계 진행과 점수 강화를 함께 확인할 후보입니다.',
      metricKind: 'UTURN',
      detailHref: '/changes?focus=score',
    },
  ];

  // v0.3-19: 판정 + 정렬 (개선중 → 유지중 → 약화중 → 제외 검토)
  // row 가 null 인 카드는 판정을 'KEEPING' 로 두되, 정렬에서 뒤로 보낸다(가장 우선순위 낮음 = 9).
  const enriched = specs.map((s) => {
    const j: Judgement | null = s.row ? judgeRow(s.row, scanLookup) : null;
    return { spec: s, judgement: j };
  });
  enriched.sort((a, b) => {
    const oa = a.judgement == null ? 9 : JUDGEMENT_ORDER[a.judgement];
    const ob = b.judgement == null ? 9 : JUDGEMENT_ORDER[b.judgement];
    return oa - ob;
  });

  return (
    <section className="mb-4 rounded-md border border-amber-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-900">오늘 다시 볼 후보</h2>
        <Link
          href="/changes"
          className="text-[11px] text-blue-600 hover:underline"
        >
          어제 대비 변화 자세히 보기 →
        </Link>
      </div>
      <p className="mb-3 text-[11px] leading-snug text-amber-800">
        오늘 변화 중 특히 다시 확인할 가치가 있는 종목입니다.
        매수 추천이 아니라 확인 우선순위 참고용입니다.
        {/* v0.3-16: 5 카드 ↔ 3 카드 중복 제거 안내 (사용자 명세 그대로) */}
        <br />
        <span className="text-[10px] text-amber-700">위 변화 카드에 없는 종목 중 추가로 확인할 후보입니다.</span>
        {/* v0.3-19: 판정 안내 */}
        <br />
        <span className="text-[10px] text-amber-700">
          판정은 직전 스냅샷 대비 순위·점수 변화 근사입니다 (개선중 → 유지중 → 약화중 → 제외 검토 순 표시).
        </span>
      </p>

      <div className="grid grid-cols-1 gap-2">
        {enriched.map(({ spec, judgement }) => (
          <SecondLookCard
            key={spec.label}
            order={spec.order}
            label={spec.label}
            tone={spec.tone}
            row={spec.row}
            reason={spec.reason}
            metricKind={spec.metricKind}
            detailHref={spec.detailHref}
            judgement={judgement}
            changeNote={spec.row ? buildChangeNote(spec.row) : ''}
            judgementNote={spec.row && judgement ? buildJudgementNote(judgement, spec.row) : ''}
          />
        ))}
      </div>

      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        이 영역은 매수 추천이 아니라 확인 우선순위 보조 정보입니다.
        모든 표시는 가격이 아니라 스캐너 내 후보 순위·점수의 변화입니다.
      </p>
    </section>
  );
}

function SecondLookCard({
  order, label, tone, row, reason, metricKind, detailHref,
  judgement, changeNote, judgementNote,
}: {
  order: string;
  label: string;
  tone: 'emerald' | 'sky' | 'indigo';
  row: ChangeRowLite | null;
  reason: string;
  metricKind: 'CONSISTENT' | 'MOMENTUM' | 'UTURN';
  detailHref: string;
  judgement: Judgement | null;        // v0.3-19: 판정 4단계 (null = 해당 없음)
  changeNote: string;                  // v0.3-19: 어제 대비 변화 자연 문구
  judgementNote: string;               // v0.3-19: 판정 한 줄 설명
}) {
  const toneCls =
    tone === 'emerald' ? 'border-emerald-200 bg-emerald-50' :
    tone === 'sky' ? 'border-sky-200 bg-sky-50' :
                     'border-indigo-200 bg-indigo-50';
  const headTextCls =
    tone === 'emerald' ? 'text-emerald-900' :
    tone === 'sky' ? 'text-sky-900' :
                     'text-indigo-900';

  return (
    <div className={`rounded border p-2.5 ${toneCls}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-[11px] font-semibold ${headTextCls}`}>
            {order} {label}
          </span>
          {/* v0.3-19: 판정 뱃지 — 우상단(라벨 우측). row 없으면 미렌더. */}
          {judgement && row && <JudgementBadge judgement={judgement} />}
        </div>
        <Link
          href={detailHref}
          className="text-[10px] text-blue-700 hover:underline"
          title="변화 자세히 보기"
        >
          변화 자세히 보기 →
        </Link>
      </div>

      {row == null ? (
        <div className="mt-1 text-xs text-slate-500">해당 없음</div>
      ) : (
        <>
          <Link
            href={`/stocks/${row.ticker}`}
            className="mt-1 block text-sm font-semibold text-slate-800 hover:underline"
          >
            {row.name ?? row.ticker}
            <span className="ml-1 text-[10px] font-normal text-slate-400">{row.ticker}</span>
          </Link>

          <div className="mt-0.5 text-[11px] tabular-nums text-slate-700">
            {metricKind === 'CONSISTENT' && (
              <>
                {row.today_rank != null && <>TOP10 {row.today_rank}위 · </>}
                {row.today_score != null && (
                  <>점수 {fmtScoreSimple(row.today_score)}</>
                )}
                {row.score_delta != null && (
                  <> ({Number(row.score_delta) > 0 ? '+' : ''}{Number(row.score_delta).toFixed(1)})</>
                )}
              </>
            )}
            {metricKind === 'MOMENTUM' && (
              <>
                {row.yesterday_rank != null && row.today_rank != null && (
                  <>순위 {fmtRankSimple(row.yesterday_rank)} → {fmtRankSimple(row.today_rank)}</>
                )}
                {row.rank_delta != null && (
                  <> ▲{Math.abs(row.rank_delta)}</>
                )}
                {row.score_delta != null && (
                  <> · 점수 +{Number(row.score_delta).toFixed(1)}</>
                )}
              </>
            )}
            {metricKind === 'UTURN' && (
              <>
                {row.today_score != null && (
                  <>현재 점수 {fmtScoreSimple(row.today_score)}</>
                )}
                {row.score_delta != null && (
                  <> · 직전 대비 +{Number(row.score_delta).toFixed(1)}</>
                )}
                {row.today_rank != null && (
                  <> · 순위 {row.today_rank}위</>
                )}
              </>
            )}
          </div>

          {(row.today_stage || row.yesterday_stage) && (
            <div className="mt-0.5 text-[11px] text-slate-600">
              <span className="text-slate-500">{row.today_stage ? '현재단계' : '직전단계'}</span>{' '}
              <span className="font-medium text-slate-800">{row.today_stage ?? row.yesterday_stage}</span>
              {row.today_sector && (
                <span className="ml-2 text-slate-500">섹터 <span className="text-slate-800">{row.today_sector}</span></span>
              )}
            </div>
          )}

          {/* v0.3-19: 어제 대비 변화 + 판정 한 줄 영역 (row 있을 때만) */}
          {changeNote && (
            <p className="mt-1.5 text-[11px] leading-snug text-slate-700">
              <span className="text-slate-500">📊 어제 대비 변화:</span>{' '}
              <span className="tabular-nums">{changeNote}</span>
            </p>
          )}
          <p className="mt-1 text-[10px] leading-snug text-slate-600">
            💡 유지 이유: {reason}
          </p>
          {judgementNote && judgement && (
            <p className="mt-1 text-[11px] leading-snug text-slate-700">
              <span className="font-medium">{JUDGEMENT_ICON[judgement]} 판정:</span>{' '}
              <span className="text-slate-700">{judgementNote}</span>
            </p>
          )}

          <div className="mt-1 text-right">
            <Link
              href={`/stocks/${row.ticker}`}
              className="text-[10px] text-blue-600 hover:underline"
            >
              종목 상세 →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// v0.3-19: 판정 뱃지 — 🟢 개선중 / 🔵 유지중 / 🟡 약화중 / 🔴 제외 검토
// ─────────────────────────────────────────────────────────────────────────
function JudgementBadge({ judgement }: { judgement: Judgement }) {
  const cls =
    judgement === 'IMPROVING'      ? 'border-emerald-300 bg-emerald-100 text-emerald-900' :
    judgement === 'KEEPING'        ? 'border-sky-300 bg-sky-100 text-sky-900' :
    judgement === 'WEAKENING'      ? 'border-amber-300 bg-amber-100 text-amber-900' :
                                     'border-red-300 bg-red-100 text-red-900';
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${cls}`}
      title={`판정: ${JUDGEMENT_LABEL[judgement]}`}
    >
      <span aria-hidden>{JUDGEMENT_ICON[judgement]}</span>
      <span>{JUDGEMENT_LABEL[judgement]}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// v0.3-17: "✨ 오늘 한 줄 요약" 박스 (D-1)
// 첫 화면에 핵심 정보를 한눈에 노출하기 위한 컴팩트 박스.
// 이미 계산된 값만 재사용:
//   - changeDump.summary  (compare_snapshots.py v0.3-7부터 존재하는 키)
//   - secondLookPicks     (v0.3-15/16에서 이미 계산된 3 후보 픽)
// 새 fetch / 헬퍼 / JSON 키 요구 0건. 분석 로직 변경 0건.
// ─────────────────────────────────────────────────────────────────────────

function TodaySummaryLineBox({
  dump, secondLookPicks,
}: { dump: ChangeDumpLite | null; secondLookPicks: HomeSecondLookPicks }) {
  // 데이터가 없거나 status 정상이 아니면 박스 자체 미렌더.
  // (SidecarFreshnessBox / HomeSummaryCard 가 이미 안내를 처리하고 있음)
  if (!dump || dump.status !== 'ok') return null;
  const s = dump.summary;
  if (!s) return null;

  // 강한 후보 = 3 카드 종목명 (truthy 만 모음)
  const strongCandidates = [
    secondLookPicks.topConsistent?.name,
    secondLookPicks.topMomentum?.name,
    secondLookPicks.topUTurnStrong?.name,
  ].filter((n): n is string => !!n);

  const previousDate = dump.previous_date ?? dump.yesterday_date;
  const compareLabel = dump.compare_label
    ?? (dump.today_date && previousDate ? `${dump.today_date} vs ${previousDate}` : dump.today_date);

  return (
    <section className="mb-4 rounded-md border border-amber-200 bg-amber-50/40 p-3 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-amber-900">
          ✨ 오늘 한 줄 요약
        </h2>
        {compareLabel && (
          <div className="text-[11px] tabular-nums text-amber-700">
            기준일 <span className="text-amber-900">{dump.today_date ?? '-'}</span>
            {previousDate && (
              <> · 비교 <span className="text-amber-900">{previousDate}</span></>
            )}
          </div>
        )}
      </div>

      {/* 카운트 한 줄 */}
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px] tabular-nums text-slate-700">
        <span><span className="text-slate-500">신규</span> <strong className="text-slate-800">{(s.n_new_entries ?? 0).toLocaleString()}</strong></span>
        <span className="text-slate-300">·</span>
        <span><span className="text-slate-500">순위↑</span> <strong className="text-slate-800">{(s.n_rank_up ?? 0).toLocaleString()}</strong></span>
        <span className="text-slate-300">·</span>
        <span><span className="text-slate-500">순위↓</span> <strong className="text-slate-800">{(s.n_rank_down ?? 0).toLocaleString()}</strong></span>
        <span className="text-slate-300">·</span>
        <span><span className="text-slate-500">점수↑</span> <strong className="text-slate-800">{(s.n_score_up ?? 0).toLocaleString()}</strong></span>
        <span className="text-slate-300">·</span>
        <span><span className="text-slate-500">이탈</span> <strong className="text-slate-800">{(s.n_departed ?? 0).toLocaleString()}</strong></span>
      </p>

      {/* 강한 후보 한 줄 (3 카드 종목명 truthy 만) */}
      {strongCandidates.length > 0 && (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[12px] text-slate-700">
          <span className="text-slate-500">강한 후보:</span>
          <span className="font-medium text-slate-800">{strongCandidates.join(' · ')}</span>
          <Link
            href="/changes"
            className="ml-auto text-[11px] text-blue-700 hover:underline"
          >
            자세히 보기 →
          </Link>
        </p>
      )}

      <p className="mt-1.5 text-[10px] leading-snug text-amber-700">
        한눈에 보기 위한 요약입니다. 매수 추천이 아니라 관찰 보조 정보이며, 자세한 내용은 아래 카드와 /changes 화면에서 확인하세요.
      </p>
    </section>
  );
}
