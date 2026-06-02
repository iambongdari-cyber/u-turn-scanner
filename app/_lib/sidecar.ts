// app/_lib/sidecar.ts
// 사이드카 JSON(2종)을 안전하게 읽어 ticker별 컨텍스트로 모은다.
// - 파일 없음/파싱 실패 모두 graceful 처리. 화면이 절대 깨지지 않도록 모든 분기 try/catch.
// - 서버 컴포넌트 전용(fs 사용). 클라이언트에서 import 시 빌드 시점에 알아서 막힘.

import { readFile } from 'fs/promises';
import path from 'path';

export interface SidecarTickerContext {
  stage: string | null;            // 바닥 관찰 / U턴 시도 / U턴 확인 / 추세전환 후보
  classification: string | null;   // 진짜 주도주 후보 / 후발주 관찰 / 기회 후보 / 추격 위험 / 보유자 대응 / 조건 부족
  evidence: string[];              // 합쳐진 근거 라벨 (scan + sector)
  news_critical: boolean;
  chase_risk_reasons: string[];
  sector?: string | null;
}

export interface SidecarBundle {
  contexts: Map<string, SidecarTickerContext>;
  scanMissing: boolean;
  sectorMissing: boolean;
  scanError: boolean;
  sectorError: boolean;
  hasAny: boolean;                 // 둘 중 하나라도 정상 로딩됐는지
}

type ReadOk<T> = { ok: true; data: T };
type ReadFail = { ok: false; missing: boolean };

async function readJson<T>(name: string): Promise<ReadOk<T> | ReadFail> {
  const filePath = path.join(process.cwd(), 'logs', 'sidecar', name);
  let buf: string;
  try {
    buf = await readFile(filePath, 'utf-8');
  } catch {
    return { ok: false, missing: true };
  }
  try {
    return { ok: true, data: JSON.parse(buf) as T };
  } catch {
    return { ok: false, missing: false };
  }
}

function ensureContext(map: Map<string, SidecarTickerContext>, ticker: string): SidecarTickerContext {
  let c = map.get(ticker);
  if (!c) {
    c = {
      stage: null,
      classification: null,
      evidence: [],
      news_critical: false,
      chase_risk_reasons: [],
      sector: null,
    };
    map.set(ticker, c);
  }
  return c;
}

export async function loadSidecarBundle(): Promise<SidecarBundle> {
  const contexts = new Map<string, SidecarTickerContext>();

  const [scanR, sectorR] = await Promise.all([
    readJson<Record<string, unknown>>('scan_dump_latest.json'),
    readJson<Record<string, unknown>>('sector_dump_latest.json'),
  ]);

  // ── scan_dump 흡수: all_stage_labels (stage), candidates_bottom (stage+evidence), chase_risk_strong (reasons)
  if (scanR.ok) {
    const d = scanR.data as {
      all_stage_labels?: Array<{ ticker: string; stage?: string | null; news_critical?: boolean; sector?: string | null }>;
      candidates_bottom?: Array<{ ticker: string; stage?: string | null; evidence?: string[]; news_critical?: boolean; sector?: string | null }>;
      chase_risk_strong?: Array<{ ticker: string; reasons?: string[]; news_critical?: boolean }>;
    };
    for (const s of (d.all_stage_labels ?? [])) {
      const c = ensureContext(contexts, s.ticker);
      if (s.stage) c.stage = s.stage;
      if (s.news_critical) c.news_critical = true;
      if (s.sector && !c.sector) c.sector = s.sector;
    }
    for (const b of (d.candidates_bottom ?? [])) {
      const c = ensureContext(contexts, b.ticker);
      if (b.stage) c.stage = b.stage;
      if (b.evidence) c.evidence.push(...b.evidence);
      if (b.news_critical) c.news_critical = true;
      if (b.sector && !c.sector) c.sector = b.sector;
    }
    for (const cr of (d.chase_risk_strong ?? [])) {
      const c = ensureContext(contexts, cr.ticker);
      if (cr.reasons) c.chase_risk_reasons.push(...cr.reasons);
      if (cr.news_critical) c.news_critical = true;
    }
  }

  // ── sector_dump 흡수: 강한/약한 섹터의 4개 분류 → classification + sector + evidence
  if (sectorR.ok) {
    const d = sectorR.data as {
      sectors_strong?: Array<{ sector?: string; leaders?: unknown[]; followers?: unknown[]; opportunities?: unknown[]; chase_risk?: unknown[] }>;
      sectors_weak?: Array<{ sector?: string; leaders?: unknown[]; followers?: unknown[]; opportunities?: unknown[]; chase_risk?: unknown[] }>;
    };
    const sectors = [...(d.sectors_strong ?? []), ...(d.sectors_weak ?? [])];
    const buckets: Array<['leaders' | 'followers' | 'opportunities' | 'chase_risk', string]> = [
      ['leaders', '진짜 주도주 후보'],
      ['followers', '후발주 관찰'],
      ['opportunities', '기회 후보'],
      ['chase_risk', '추격 위험'],
    ];
    for (const sb of sectors) {
      for (const [key, label] of buckets) {
        const arr = (sb[key] as Array<{ ticker?: string; evidence?: string[] }> | undefined) ?? [];
        for (const m of arr) {
          if (!m.ticker) continue;
          const c = ensureContext(contexts, m.ticker);
          if (!c.classification) c.classification = label;
          if (m.evidence) c.evidence.push(...m.evidence);
          if (sb.sector && !c.sector) c.sector = sb.sector;
        }
      }
    }
  }

  // ── evidence / chase_risk_reasons 중복 제거
  for (const c of contexts.values()) {
    if (c.evidence.length > 0) c.evidence = Array.from(new Set(c.evidence));
    if (c.chase_risk_reasons.length > 0) c.chase_risk_reasons = Array.from(new Set(c.chase_risk_reasons));
  }

  return {
    contexts,
    scanMissing: !scanR.ok && (scanR as ReadFail).missing,
    scanError: !scanR.ok && !(scanR as ReadFail).missing,
    sectorMissing: !sectorR.ok && (sectorR as ReadFail).missing,
    sectorError: !sectorR.ok && !(sectorR as ReadFail).missing,
    hasAny: scanR.ok || sectorR.ok,
  };
}

export function stageBadgeClass(stage: string | null | undefined): string {
  switch (stage) {
    case '바닥 관찰': return 'bg-emerald-100 text-emerald-800';
    case 'U턴 시도': return 'bg-sky-100 text-sky-800';
    case 'U턴 확인': return 'bg-indigo-100 text-indigo-800';
    case '추세전환 후보': return 'bg-violet-100 text-violet-800';
    default: return 'bg-slate-100 text-slate-700';
  }
}

export function classificationBadgeClass(label: string | null | undefined): string {
  switch (label) {
    case '진짜 주도주 후보': return 'bg-amber-100 text-amber-900';
    case '후발주 관찰': return 'bg-sky-100 text-sky-800';
    case '기회 후보': return 'bg-emerald-100 text-emerald-800';
    case '추격 위험': return 'bg-orange-100 text-orange-800';
    case '보유자 대응': return 'bg-slate-200 text-slate-700';
    case '조건 부족': return 'bg-slate-100 text-slate-600';
    default: return 'bg-slate-100 text-slate-600';
  }
}
