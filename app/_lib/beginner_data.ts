// app/_lib/beginner_data.ts
// v0.4-3 사이드카에서 BeginnerRow 추출 + 놓친 리포트 + 날짜 파라미터 지원
// - 서버 컴포넌트 전용 (fs 사용)
// - date 파라미터:
//   - undefined → logs/sidecar/scan_dump_latest.json (기본)
//   - 'YYYY-MM-DD' → logs/sidecar/daily/scan_dump_YYYY-MM-DD.json

import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { BeginnerRow } from './beginner';
import { computeUrgency, selectTradePlanTargets, TodayBriefItem } from './today_brief';
import {
  judgeMarketRegime,
  MarketRegimeResult,
  ScanMarketRaw,
  ScanSummaryRaw,
  SectorRegimeRaw,
} from './market_regime';
import {
  judgeMarketStrength,
  judgeCapStyle,
  MarketStrength,
  CapStyle,
} from './market_strength';

interface CandidateBottomRaw {
  ticker: string;
  name: string;
  sector?: string | null;
  market?: string | null;
  stage?: string | null;
  close?: number | null;
  ma60?: number | null;
  disparity_pct?: number | null;
  golden_days_ago?: number | null;
  days_below_ma60_60d?: number | null;
  value_ratio?: number | null;
  avg_value_20_eok?: number | null;
  checks?: {
    uturn_ok?: boolean;
    value_recovering?: boolean;
    ma60_rising?: boolean;
    lagging_ok?: boolean;
    cloud_red?: boolean;
    above_ma60?: boolean;
    value_ok?: boolean;
  };
  evidence?: string[];
  news_critical?: boolean;
  final_grade_from_run_scan?: string;
}

interface ScanDumpRaw {
  base_date?: string | null;
  candidates_bottom?: CandidateBottomRaw[];
  market?: ScanMarketRaw | null;
  summary?: ScanSummaryRaw | null;
}

interface SectorMemberRaw {
  ticker?: string;
  name?: string;
  sector?: string;
  evidence?: string[];
}

interface SectorGroupRaw {
  sector?: string;
  leaders?: SectorMemberRaw[];
  followers?: SectorMemberRaw[];
  opportunities?: SectorMemberRaw[];
  chase_risk?: SectorMemberRaw[];
}

interface SectorDumpRaw {
  sectors_strong?: SectorGroupRaw[];
  sectors_weak?: SectorGroupRaw[];
  market_flow?: string | null;
}

// ───────────────────────────────────────────────────────────────
// 파일 위치 헬퍼
// ───────────────────────────────────────────────────────────────
const SIDECAR_DIR = path.join(process.cwd(), 'logs', 'sidecar');
const DAILY_DIR = path.join(SIDECAR_DIR, 'daily');

async function readJsonSafeAt<T>(filePath: string): Promise<T | null> {
  try {
    const buf = await readFile(filePath, 'utf-8');
    return JSON.parse(buf) as T;
  } catch {
    return null;
  }
}

/** date 가 주어지면 daily/scan_dump_YYYY-MM-DD.json, 아니면 latest */
async function readScanForDate(date: string | undefined): Promise<ScanDumpRaw | null> {
  if (date) {
    return readJsonSafeAt<ScanDumpRaw>(path.join(DAILY_DIR, `scan_dump_${date}.json`));
  }
  return readJsonSafeAt<ScanDumpRaw>(path.join(SIDECAR_DIR, 'scan_dump_latest.json'));
}

/**
 * date 가 주어지면 daily/sector_dump_YYYY-MM-DD.json,
 * 일치 파일 없으면 가장 가까운 이전 날짜로 fallback (호스트 데이터 패턴 대응).
 */
async function readSectorForDate(date: string | undefined): Promise<SectorDumpRaw | null> {
  if (!date) {
    return readJsonSafeAt<SectorDumpRaw>(path.join(SIDECAR_DIR, 'sector_dump_latest.json'));
  }
  // 정확 일치 우선
  const exact = await readJsonSafeAt<SectorDumpRaw>(path.join(DAILY_DIR, `sector_dump_${date}.json`));
  if (exact) return exact;
  // 가장 가까운 이전 sector_dump 찾기
  try {
    const files = await readdir(DAILY_DIR);
    const sectorFiles = files
      .filter(f => /^sector_dump_\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .filter(f => {
        const m = f.match(/sector_dump_(\d{4}-\d{2}-\d{2})\.json$/);
        return m && m[1] <= date;
      })
      .sort()
      .reverse();
    if (sectorFiles.length > 0) {
      return readJsonSafeAt<SectorDumpRaw>(path.join(DAILY_DIR, sectorFiles[0]));
    }
  } catch {
    // ignore
  }
  return null;
}

// ───────────────────────────────────────────────────────────────
// 사이드카 → BeginnerRow 리스트
// ───────────────────────────────────────────────────────────────
export interface BeginnerDataBundle {
  base_date: string | null;
  rows: BeginnerRow[];
  scanMissing: boolean;
  sectorMissing: boolean;
  hasData: boolean;
  priceByTicker: Map<string, number>;
  /** 요청된 date (URL ?date=) — 호출 측이 그대로 받음. 없으면 null = 최신 */
  requestedDate: string | null;
  /** 실제 로드된 sidecar 의 base_date 와 동일 (= 표시 기준일) */
  effectiveDate: string | null;
  /** v0.5 시장 상태 판단 결과. 데이터 부족 시 UNKNOWN 으로 채워짐. */
  marketRegime: MarketRegimeResult;
  /** v0.8-1 KOSPI/KOSDAQ 강도 + 상대강도 + 자연어 */
  marketStrength: MarketStrength;
  /** v0.8-1 대형주/중소형주 흐름 */
  capStyle: CapStyle;
}

export async function loadBeginnerData(date?: string): Promise<BeginnerDataBundle> {
  const [scan, sector] = await Promise.all([
    readScanForDate(date),
    readSectorForDate(date),
  ]);

  const rowsMap = new Map<string, BeginnerRow>();
  const priceByTicker = new Map<string, number>();

  if (scan && Array.isArray(scan.candidates_bottom)) {
    for (const c of scan.candidates_bottom) {
      if (!c.ticker) continue;
      rowsMap.set(c.ticker, {
        ticker: c.ticker,
        name: c.name,
        sector: c.sector ?? null,
        market: c.market ?? null,
        stage: c.stage ?? null,
        close: c.close ?? null,
        ma60: c.ma60 ?? null,
        disparity_pct: c.disparity_pct ?? null,
        golden_days_ago: c.golden_days_ago ?? null,
        days_below_ma60_60d: c.days_below_ma60_60d ?? null,
        value_ratio: c.value_ratio ?? null,
        avg_value_20_eok: c.avg_value_20_eok ?? null,
        checks: c.checks ?? null,
        evidence: c.evidence ?? [],
        news_critical: c.news_critical ?? false,
        classification: null,
      });
      if (c.close != null) priceByTicker.set(c.ticker, c.close);
    }
  }

  if (sector) {
    const sectors = [...(sector.sectors_strong ?? []), ...(sector.sectors_weak ?? [])];
    const buckets: Array<['leaders' | 'followers' | 'opportunities' | 'chase_risk', string]> = [
      ['leaders', '진짜 주도주 후보'],
      ['followers', '후발주 관찰'],
      ['opportunities', '기회 후보'],
      ['chase_risk', '추격 위험'],
    ];
    for (const sb of sectors) {
      for (const [key, label] of buckets) {
        const arr = (sb[key] as SectorMemberRaw[] | undefined) ?? [];
        for (const m of arr) {
          if (!m.ticker) continue;
          const existing = rowsMap.get(m.ticker);
          if (existing) {
            if (!existing.classification) existing.classification = label;
            if (m.evidence) existing.evidence = [...(existing.evidence ?? []), ...m.evidence];
          } else {
            if (key === 'leaders' || key === 'followers' || key === 'opportunities') {
              rowsMap.set(m.ticker, {
                ticker: m.ticker,
                name: m.name ?? m.ticker,
                sector: sb.sector ?? null,
                evidence: m.evidence ?? [],
                classification: label,
              });
            }
          }
        }
      }
    }
  }

  for (const r of rowsMap.values()) {
    if (r.evidence && r.evidence.length > 0) {
      r.evidence = Array.from(new Set(r.evidence)).slice(0, 6);
    }
  }

  const rows = Array.from(rowsMap.values());

  // v0.6.1 시장 상태 판단 — 종목명은 클라이언트(CoachShell)에서 selectTradePlanTargets 결과로 override
  // 서버는 plans 를 모르므로 topPickName 미전달 → buildConclusionText 의 fallback 문구로 빌드.
  const marketRegime = judgeMarketRegime({
    market: scan?.market ?? null,
    summary: scan?.summary ?? null,
    sector: sector
      ? {
          market_flow: sector.market_flow ?? null,
          sectors_strong: sector.sectors_strong as SectorRegimeRaw['sectors_strong'],
          sectors_weak: sector.sectors_weak as SectorRegimeRaw['sectors_weak'],
        }
      : null,
  });

  // v0.8-1 KOSPI/KOSDAQ 강도 + 대형주/중소형주
  const marketStrength = judgeMarketStrength(scan?.market ?? null);
  const capStyle = judgeCapStyle(marketStrength);

  return {
    base_date: scan?.base_date ?? date ?? null,
    rows,
    scanMissing: scan == null,
    sectorMissing: sector == null,
    hasData: rows.length > 0,
    priceByTicker,
    requestedDate: date ?? null,
    effectiveDate: scan?.base_date ?? date ?? null,
    marketRegime,
    marketStrength,
    capStyle,
  };
}

// ───────────────────────────────────────────────────────────────
// 어제 AI 판단 — 선택 날짜 직전의 가장 가까운 scan_dump
// ───────────────────────────────────────────────────────────────
export async function loadPreviousScanRows(date?: string): Promise<{
  base_date: string | null;
  rows: BeginnerRow[];
}> {
  let files: string[] = [];
  try {
    files = await readdir(DAILY_DIR);
  } catch {
    return { base_date: null, rows: [] };
  }
  const scanFiles = files
    .filter(f => /^scan_dump_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();

  // date 주어지면 그보다 이전 가장 가까운 파일, 없으면 최신 - 1
  let prevFile: string | null = null;
  if (date) {
    for (const f of scanFiles) {
      const m = f.match(/scan_dump_(\d{4}-\d{2}-\d{2})\.json$/);
      if (m && m[1] < date) { prevFile = f; break; }
    }
  } else {
    // 최신 (= scanFiles[0]) 가 latest 와 같을 가능성 → 두 번째 사용
    if (scanFiles.length >= 2) prevFile = scanFiles[1];
  }

  if (!prevFile) return { base_date: null, rows: [] };

  try {
    const buf = await readFile(path.join(DAILY_DIR, prevFile), 'utf-8');
    const d = JSON.parse(buf) as ScanDumpRaw;
    const rows: BeginnerRow[] = (d.candidates_bottom ?? []).map(c => ({
      ticker: c.ticker,
      name: c.name,
      sector: c.sector ?? null,
      stage: c.stage ?? null,
      close: c.close ?? null,
      ma60: c.ma60 ?? null,
      disparity_pct: c.disparity_pct ?? null,
      checks: c.checks ?? null,
      evidence: c.evidence ?? [],
      news_critical: c.news_critical ?? false,
      classification: null,
    }));
    return { base_date: d.base_date ?? null, rows };
  } catch {
    return { base_date: null, rows: [] };
  }
}

// ───────────────────────────────────────────────────────────────
// 놓친 리포트 → v0.4-3 "지난 투자판단" 리스트
// daily 폴더의 scan_dump_*.json 전체를 날짜 내림차순으로
// ───────────────────────────────────────────────────────────────
export interface PastJudgmentEntry {
  date: string;                       // YYYY-MM-DD
  file: string;                       // scan_dump_YYYY-MM-DD.json
  candidatesCount: number;
  /** v0.4-4: 1순위 종목명 (신규 후보 기준 selectTradePlanTargets 첫번째) */
  topPickName: string | null;
  topPickTicker: string | null;
}

export interface PastJudgmentsBundle {
  totalCount: number;
  reports: PastJudgmentEntry[];
}

/**
 * 1순위 종목 계산 — daily scan_dump 한 파일에 대해 신규 후보 기준 selectTradePlanTargets() 첫 번째.
 * plans 정보가 없으므로 hasHoldingOrReserved=false 가정.
 */
function computeTopPickFromCandidates(
  candidates: CandidateBottomRaw[],
): { name: string; ticker: string } | null {
  if (!candidates || candidates.length === 0) return null;

  // BeginnerRow 로 변환
  const rows: BeginnerRow[] = candidates.map(c => ({
    ticker: c.ticker,
    name: c.name,
    sector: c.sector ?? null,
    market: c.market ?? null,
    stage: c.stage ?? null,
    close: c.close ?? null,
    ma60: c.ma60 ?? null,
    disparity_pct: c.disparity_pct ?? null,
    golden_days_ago: c.golden_days_ago ?? null,
    days_below_ma60_60d: c.days_below_ma60_60d ?? null,
    value_ratio: c.value_ratio ?? null,
    avg_value_20_eok: c.avg_value_20_eok ?? null,
    checks: c.checks ?? null,
    evidence: c.evidence ?? [],
    news_critical: c.news_critical ?? false,
    classification: null,
  }));

  // computeUrgency 로 URGENCY 부여 후 TodayBriefItem 화
  const items: TodayBriefItem[] = rows.map(r => ({
    ticker: r.ticker,
    name: r.name,
    urgency: computeUrgency({
      plan: null,
      row: r,
      currentPrice: r.close ?? null,
      previousJudgement: null,
    }),
    plan: null,
    row: r,
    currentPrice: r.close ?? null,
  }));

  const selected = selectTradePlanTargets(items, false);
  if (selected.length === 0) return null;
  const first = selected[0];
  return { name: first.name, ticker: first.ticker };
}

export async function loadMissedReports(): Promise<PastJudgmentsBundle> {
  const dailyDir = DAILY_DIR;
  let files: string[] = [];
  try {
    files = await readdir(dailyDir);
  } catch {
    return { totalCount: 0, reports: [] };
  }
  const scanFiles = files
    .filter(f => /^scan_dump_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  const entries: PastJudgmentEntry[] = [];
  for (const f of scanFiles.slice(0, 60)) {
    const m = f.match(/scan_dump_(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const date = m[1];
    let candidatesCount = 0;
    let topPickName: string | null = null;
    let topPickTicker: string | null = null;
    try {
      const st = await stat(path.join(dailyDir, f));
      if (st.size < 50_000_000) {
        const buf = await readFile(path.join(dailyDir, f), 'utf-8');
        const d = JSON.parse(buf) as ScanDumpRaw;
        const candidates = d.candidates_bottom ?? [];
        candidatesCount = candidates.length;
        const top = computeTopPickFromCandidates(candidates);
        if (top) {
          topPickName = top.name;
          topPickTicker = top.ticker;
        }
      }
    } catch {
      // ignore
    }
    entries.push({ date, file: f, candidatesCount, topPickName, topPickTicker });
  }
  return {
    totalCount: scanFiles.length,
    reports: entries,
  };
}

// ───────────────────────────────────────────────────────────────
// 별칭 export (UI에서 사용)
// ───────────────────────────────────────────────────────────────
export type MissedReportEntry = PastJudgmentEntry;
export const loadPastJudgments = loadMissedReports;
