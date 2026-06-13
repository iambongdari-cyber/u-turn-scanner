// app/_lib/beginner_data.ts
// v0.4 사이드카에서 BeginnerRow 추출 + 놓친 리포트 스캔
// - 서버 컴포넌트 전용 (fs 사용)

import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { BeginnerRow } from './beginner';

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
}

async function readJsonSafe<T>(name: string): Promise<T | null> {
  const filePath = path.join(process.cwd(), 'logs', 'sidecar', name);
  try {
    const buf = await readFile(filePath, 'utf-8');
    return JSON.parse(buf) as T;
  } catch {
    return null;
  }
}

export async function loadBeginnerData(): Promise<BeginnerDataBundle> {
  const [scan, sector] = await Promise.all([
    readJsonSafe<ScanDumpRaw>('scan_dump_latest.json'),
    readJsonSafe<SectorDumpRaw>('sector_dump_latest.json'),
  ]);

  const rowsMap = new Map<string, BeginnerRow>();
  const priceByTicker = new Map<string, number>();

  // scan_dump candidates_bottom 흡수
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

  // sector_dump 4 분류 → classification 보강
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
            // scan 에 없지만 sector 에서 잡힌 종목 — 주도주/후발주/기회 카테고리만 추가
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

  // 중복 evidence 제거
  for (const r of rowsMap.values()) {
    if (r.evidence && r.evidence.length > 0) {
      r.evidence = Array.from(new Set(r.evidence)).slice(0, 6);
    }
  }

  const rows = Array.from(rowsMap.values());

  return {
    base_date: scan?.base_date ?? null,
    rows,
    scanMissing: scan == null,
    sectorMissing: sector == null,
    hasData: rows.length > 0,
    priceByTicker,
  };
}

// ───────────────────────────────────────────────────────────────
// 어제 AI 판단 — daily 폴더에서 직전 scan_dump 읽어 비교용
// ───────────────────────────────────────────────────────────────
export async function loadPreviousScanRows(): Promise<{
  base_date: string | null;
  rows: BeginnerRow[];
}> {
  const dailyDir = path.join(process.cwd(), 'logs', 'sidecar', 'daily');
  let files: string[] = [];
  try {
    files = await readdir(dailyDir);
  } catch {
    return { base_date: null, rows: [] };
  }
  const scanFiles = files
    .filter(f => f.startsWith('scan_dump_') && f.endsWith('.json'))
    .sort()
    .reverse();
  // 가장 최근 2 개 중 첫 번째는 오늘, 두 번째가 직전
  if (scanFiles.length < 2) return { base_date: null, rows: [] };
  const prev = scanFiles[1];
  const filePath = path.join(dailyDir, prev);
  try {
    const buf = await readFile(filePath, 'utf-8');
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
// 놓친 리포트 — daily 폴더 스캔 + 마지막 확인일 기준
// ───────────────────────────────────────────────────────────────
export interface MissedReportEntry {
  date: string;                // YYYY-MM-DD
  file: string;                // scan_dump_YYYY-MM-DD.json
  candidatesCount: number;     // 후보 개수
}

export interface MissedReportsBundle {
  totalCount: number;          // daily 폴더 안 전체 scan_dump 파일 수
  missedReports: MissedReportEntry[];
  lastSeenDate: string | null; // 사용자가 마지막으로 본 날짜 (서버는 모름, client 에서 비교)
}

export async function loadMissedReports(): Promise<MissedReportsBundle> {
  const dailyDir = path.join(process.cwd(), 'logs', 'sidecar', 'daily');
  let files: string[] = [];
  try {
    files = await readdir(dailyDir);
  } catch {
    return { totalCount: 0, missedReports: [], lastSeenDate: null };
  }
  const scanFiles = files
    .filter(f => /^scan_dump_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  const entries: MissedReportEntry[] = [];
  for (const f of scanFiles.slice(0, 10)) {
    const m = f.match(/scan_dump_(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const date = m[1];
    let candidatesCount = 0;
    try {
      const st = await stat(path.join(dailyDir, f));
      if (st.size < 50_000_000) {
        const buf = await readFile(path.join(dailyDir, f), 'utf-8');
        const d = JSON.parse(buf) as ScanDumpRaw;
        candidatesCount = (d.candidates_bottom ?? []).length;
      }
    } catch {
      // ignore
    }
    entries.push({ date, file: f, candidatesCount });
  }
  return {
    totalCount: scanFiles.length,
    missedReports: entries,
    lastSeenDate: null,
  };
}
