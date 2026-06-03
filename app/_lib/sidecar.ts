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

// ───────────────────────────────────────────────────────────────
// v0.3-3: 화면 표시용 헬퍼
// 모든 문구는 "관찰/복기/확인 보조" 표현으로 작성한다.
// "매수/매도 추천", "확정 상승", "반드시 매수" 등 단정 표현은 절대 사용하지 않는다.
// 투자 판단은 사용자가 직접 한다.
// ───────────────────────────────────────────────────────────────

export interface LabelDisplay {
  icon: string;
  short: string;   // 한 줄 짧은 해석 (배지 옆에 붙는 보조 문구)
  desc: string;    // 단계/분류 자체의 설명
  caution: string; // 라벨별 주의 문구 (사용자가 다음에 확인해야 할 것)
}

const STAGE_DISPLAY: Record<string, LabelDisplay> = {
  '바닥 관찰': {
    icon: '🌱',
    short: '바닥권 + U턴 검증 충족, 골든크로스는 아직',
    desc: '60일선 위에 있고 최근 60일 중 60일선 아래에 머무른 날이 10일 이상이지만, 아직 단기선의 골든크로스가 감지되지 않은 상태입니다.',
    caution: '추세 신호가 아직 약함 — 거래대금 회복과 단기선 상향 돌파를 함께 확인하세요.',
  },
  'U턴 시도': {
    icon: '🔄',
    short: '0~1거래일 전 골든크로스 — 시도 직후',
    desc: '최근 0~1거래일 사이에 10일선이 60일선을 위로 통과한 상태입니다. 추세 전환이 시작되었는지 추가 확인이 필요합니다.',
    caution: '신호 발생 직후라 되돌림 가능성이 큼 — 종가 이탈·거래대금 감소를 함께 보세요.',
  },
  'U턴 확인': {
    icon: '✅',
    short: '2~5거래일 전 골든크로스 — 자리잡는 중',
    desc: '2~5거래일 전에 골든크로스가 발생해 U턴이 자리잡아 가는 상태입니다.',
    caution: '이격이 빠르게 벌어지는지, 60일선이 무너지는지 함께 확인하세요.',
  },
  '추세전환 후보': {
    icon: '📈',
    short: '6거래일 이상 전 골든크로스 — 추세 형성',
    desc: '6거래일 이상 전에 골든크로스가 발생해 단기 추세가 자리잡힌 상태입니다.',
    caution: '이미 이격이 큰 경우 추격 위험과 함께 살피세요. 60일선 회귀 시 대응 시나리오를 미리 정리.',
  },
};

const CLASSIFICATION_DISPLAY: Record<string, LabelDisplay> = {
  '진짜 주도주 후보': {
    icon: '🥇',
    short: '돈의 흐름 + 가격 위치 동시 충족',
    desc: '같은 섹터 안에서 60일선 위에 있고, 전고점 근접 + 거래대금 임계 충족 + 이격이 과도하지 않은 종목입니다.',
    caution: '진입 가격은 사용자가 직접 판단 — 추격 위험 구간(이격 +20% 이상)에서는 분할·관망 등 본인 원칙을 따르세요.',
  },
  '후발주 관찰': {
    icon: '🥈',
    short: '주도주를 따라가는 후발 종목',
    desc: '같은 섹터 강세 흐름에서 주도주를 뒤따라가는 종목으로, 전고점 70~90% 구간에 있습니다.',
    caution: '주도주가 무너지면 후발주는 더 빠르게 약해질 수 있음 — 섹터 강도 유지 여부와 함께 보세요.',
  },
  '기회 후보': {
    icon: '🎯',
    short: '60일선 위 + 거래대금 임계는 충족',
    desc: '60일선 위에서 거래대금 임계는 충족하지만, 주도주·후발주 기준에는 아직 미달하는 종목입니다.',
    caution: '추세가 완성되지 않은 구간 — 거래대금이 식거나 단기선이 무너지면 빠르게 빠질 수 있습니다.',
  },
  '추격 위험': {
    icon: '⚠️',
    short: '이격 +20% 이상 — 추격 시 위험 구간',
    desc: '60일선 대비 +20% 이상 벌어진 종목입니다. 이미 단기 급등 영역으로, 신규 진입 시 추격 위험이 커집니다.',
    caution: '"지금 사야 한다"는 표시가 아닙니다. 신규 진입 위험이 크다는 경고 라벨이며, 보유 중일 때의 대응은 본인의 원칙을 따르세요.',
  },
  '보유자 대응': {
    icon: '🛡️',
    short: '보유 중일 때의 대응 참고',
    desc: '신규 진입보다는 보유자의 대응 시나리오 참고용 분류입니다.',
    caution: '본 라벨은 보유자 대응 참고일 뿐, 매도/매수 지시가 아닙니다.',
  },
  '조건 부족': {
    icon: '⏸️',
    short: '관찰 조건이 아직 부족한 상태',
    desc: '단기 추세·거래대금·가격 위치 중 일부가 충족되지 않아 관찰 우선순위가 낮은 상태입니다.',
    caution: '조건이 채워질 때까지 관찰만 — 무리한 의미 부여는 피하세요.',
  },
};

export function getStageDisplay(stage: string | null | undefined): LabelDisplay {
  if (stage && STAGE_DISPLAY[stage]) return STAGE_DISPLAY[stage];
  return { icon: '·', short: '관찰 보조', desc: '', caution: '' };
}

export function getClassificationDisplay(label: string | null | undefined): LabelDisplay {
  if (label && CLASSIFICATION_DISPLAY[label]) return CLASSIFICATION_DISPLAY[label];
  return { icon: '·', short: '관찰 보조', desc: '', caution: '' };
}

export const STAGE_ORDER: string[] = ['바닥 관찰', 'U턴 시도', 'U턴 확인', '추세전환 후보'];
export const CLASSIFICATION_ORDER: string[] = ['진짜 주도주 후보', '후발주 관찰', '기회 후보', '추격 위험'];

export interface SidecarSummaryCounts {
  stages: Record<string, number>;        // 4단계 카운트
  classifications: Record<string, number>; // 4분류 카운트
  newsCritical: number;
  chaseRisk: number;
  total: number;
}

export function summarizeSidecarCounts(bundle: SidecarBundle): SidecarSummaryCounts {
  const stages: Record<string, number> = Object.fromEntries(STAGE_ORDER.map(k => [k, 0]));
  const classifications: Record<string, number> = Object.fromEntries(CLASSIFICATION_ORDER.map(k => [k, 0]));
  let newsCritical = 0;
  let chaseRisk = 0;
  for (const c of bundle.contexts.values()) {
    if (c.stage && stages[c.stage] != null) stages[c.stage] += 1;
    if (c.classification && classifications[c.classification] != null) classifications[c.classification] += 1;
    if (c.news_critical) newsCritical += 1;
    if (c.chase_risk_reasons.length > 0) chaseRisk += 1;
  }
  return {
    stages,
    classifications,
    newsCritical,
    chaseRisk,
    total: bundle.contexts.size,
  };
}

// ───────────────────────────────────────────────────────────────
// 일지 초안 보조 문장 빌더
// 4 섹션: "왜 떴는지", "조심할 점", "내일 다시 볼 조건", "추격하지 말아야 할 이유"
// 모두 관찰·복기 보조 문구이며 매매 권유가 아니다.
// ───────────────────────────────────────────────────────────────

export interface JournalDraftInput {
  stage: string | null;
  classification: string | null;
  sector: string | null;
  evidence: string[];
  chase_risk_reasons: string[];
  news_critical: boolean;
  // 스캔 컨텍스트 보조
  disparity_pct?: number | null;
  golden_days_ago?: number | null;
}

export interface JournalDraft {
  why: string;          // 왜 떴는지
  caution: string;      // 조심할 점
  next: string;         // 내일 다시 볼 조건
  noChase: string | null; // 추격하지 말아야 할 이유 (해당 시만)
}

export function buildJournalDraft(input: JournalDraftInput): JournalDraft {
  const { stage, classification, sector, evidence, chase_risk_reasons, news_critical, disparity_pct, golden_days_ago } = input;

  // ── 왜 떴는지 (사유 합성) ──
  const whyParts: string[] = [];
  if (stage) whyParts.push(`단계 [${stage}]`);
  if (classification) whyParts.push(`분류 [${classification}]`);
  if (sector) whyParts.push(`섹터 ${sector}`);
  if (golden_days_ago != null) whyParts.push(`GC경과 ${golden_days_ago}일`);
  if (evidence.length > 0) whyParts.push(`근거 ${evidence.length}건`);
  const why = whyParts.length > 0
    ? whyParts.join(' · ') + ' — 관찰·복기 보조 표시이며 매매 권유가 아닙니다.'
    : '사이드카에서 분류·단계가 잡히지 않았습니다. 자유 메모에 직접 관찰 사유를 기록해 주세요.';

  // ── 조심할 점 (위험·뉴스·이격) ──
  const cautionParts: string[] = [];
  if (news_critical) cautionParts.push('뉴스 위험(CRITICAL 공시·중요 뉴스) 확인 필요');
  if (chase_risk_reasons.length > 0) cautionParts.push(`추격 위험: ${chase_risk_reasons.join(', ')}`);
  else if (classification === '추격 위험') cautionParts.push('이격 +20% 이상 영역 — 신규 진입 시 추격 위험');
  if (disparity_pct != null && disparity_pct >= 15 && classification !== '추격 위험') {
    cautionParts.push(`이격이 ${disparity_pct.toFixed(1)}%로 빠르게 벌어지는지 함께 확인`);
  }
  const sd = getStageDisplay(stage);
  if (sd.caution) cautionParts.push(sd.caution);
  const caution = cautionParts.length > 0
    ? cautionParts.join(' · ')
    : '특이 사항 없음 — 변동성·이격도·거래대금 변화는 계속 관찰.';

  // ── 내일 다시 볼 조건 (체크리스트) ──
  const nextParts: string[] = [];
  if (stage === '바닥 관찰') nextParts.push('단기선(10일) 상향 돌파 여부');
  if (stage === 'U턴 시도') nextParts.push('골든크로스 유지 + 종가가 60일선 위 유지');
  if (stage === 'U턴 확인') nextParts.push('이격 확장 속도 vs 거래대금 동반 여부');
  if (stage === '추세전환 후보') nextParts.push('전고점 돌파 시도 + 60일선 회귀 여부');
  if (classification === '진짜 주도주 후보') nextParts.push('섹터 강도 유지 + 전고점 근접도');
  if (classification === '후발주 관찰') nextParts.push('주도주가 살아있는지 먼저 확인');
  if (classification === '기회 후보') nextParts.push('거래대금이 식지 않는지, 단기선 무너짐 없는지');
  if (news_critical) nextParts.push('CRITICAL 공시/뉴스의 후속 사실 정리');
  if (nextParts.length === 0) nextParts.push('이격·거래대금·섹터 강도 변화');
  const next = nextParts.join(' · ');

  // ── 추격하지 말아야 할 이유 (해당 시만) ──
  let noChase: string | null = null;
  if (classification === '추격 위험' || chase_risk_reasons.length > 0) {
    const reasons = chase_risk_reasons.length > 0
      ? chase_risk_reasons.join(', ')
      : '이격 +20% 이상 단기 급등 영역';
    noChase = `${reasons} — 신규 진입은 추격 위험이 큼. 이미 보유 중이라면 본인의 손절·청산 원칙을 따르고, 신규 진입은 관망·분할 등 본인 원칙대로.`;
  } else if (disparity_pct != null && disparity_pct >= 18) {
    noChase = `이격이 ${disparity_pct.toFixed(1)}%까지 벌어진 상태 — 추격 위험 임계 부근. 신규 진입은 충분히 식힐 때까지 관망 후보.`;
  }

  return { why, caution, next, noChase };
}
