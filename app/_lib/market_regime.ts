// app/_lib/market_regime.ts
// v0.5 장세 판단 + 전략 모드
//
// 핵심:
// - 사이드카 안 7개 시그널을 합산해 5단계 + UNKNOWN 으로 분류 (내부 계산용)
// - 사용자 표시는 단순화 4단계: 강세장 / 보합장 / 약세장 / 판단 보류
// - 전략 모드 3개: 공격 / 선별 / 방어 + 짧은 반등
// - 신규 fetch 0건 — 사이드카 read-only

// ───────────────────────────────────────────────────────────────
// 내부 5단계 enum + UNKNOWN
// ───────────────────────────────────────────────────────────────
export type MarketRegime =
  | 'STRONG_BULL'
  | 'MILD_BULL'
  | 'NEUTRAL'
  | 'MILD_BEAR'
  | 'STRONG_BEAR'
  | 'UNKNOWN';

// 사용자 표시 단순화 4단계 (사용자 명세 — STRONG/MILD 통합)
export type RegimeDisplay = '강세장' | '보합장' | '약세장' | '판단 보류';

export const REGIME_DISPLAY: Record<MarketRegime, RegimeDisplay> = {
  STRONG_BULL: '강세장',
  MILD_BULL: '강세장',
  NEUTRAL: '보합장',
  MILD_BEAR: '약세장',
  STRONG_BEAR: '약세장',
  UNKNOWN: '판단 보류',
};

// 색상 (4단계 분류 기준)
export const REGIME_BADGE_CLASS: Record<MarketRegime, string> = {
  STRONG_BULL: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  MILD_BULL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  NEUTRAL: 'bg-slate-100 text-slate-700 border-slate-300',
  MILD_BEAR: 'bg-amber-100 text-amber-800 border-amber-300',
  STRONG_BEAR: 'bg-red-100 text-red-800 border-red-300',
  UNKNOWN: 'bg-slate-50 text-slate-500 border-slate-200',
};

export const REGIME_SECTION_CLASS: Record<MarketRegime, string> = {
  STRONG_BULL: 'border-emerald-300 bg-emerald-50/40',
  MILD_BULL: 'border-emerald-200 bg-emerald-50/30',
  NEUTRAL: 'border-slate-200 bg-slate-50/40',
  MILD_BEAR: 'border-amber-300 bg-amber-50/40',
  STRONG_BEAR: 'border-red-300 bg-red-50/40',
  UNKNOWN: 'border-slate-200 bg-slate-50/30',
};

// ───────────────────────────────────────────────────────────────
// 전략 모드 (사용자 명세 3개)
// ───────────────────────────────────────────────────────────────
export type RegimeMode = 'AGGRESSIVE' | 'SELECTIVE' | 'DEFENSIVE';

export const MODE_LABEL: Record<RegimeMode, string> = {
  AGGRESSIVE: '공격',
  SELECTIVE: '선별',
  DEFENSIVE: '방어 + 짧은 반등',
};

export const MODE_BADGE_CLASS: Record<RegimeMode, string> = {
  AGGRESSIVE: 'bg-emerald-100 text-emerald-800',
  SELECTIVE: 'bg-slate-200 text-slate-800',
  DEFENSIVE: 'bg-amber-100 text-amber-900',
};

export function regimeToMode(r: MarketRegime): RegimeMode {
  switch (r) {
    case 'STRONG_BULL':
    case 'MILD_BULL':
      return 'AGGRESSIVE';
    case 'NEUTRAL':
    case 'UNKNOWN':
      return 'SELECTIVE'; // 판단 보류는 보합장 가정
    case 'MILD_BEAR':
    case 'STRONG_BEAR':
      return 'DEFENSIVE';
  }
}

// ───────────────────────────────────────────────────────────────
// 시그널 + 결과 인터페이스
// ───────────────────────────────────────────────────────────────
export interface MarketSignal {
  key: string;
  label: string;        // 자연어 사유 ("KOSPI 60일선 위")
  score: number;        // -5 ~ +5
}

export interface MarketRegimeResult {
  regime: MarketRegime;
  display: RegimeDisplay;
  mode: RegimeMode;
  modeLabel: string;
  score: number;
  signals: MarketSignal[];
  reasons: string[];        // 자연어 사유 (signals 의 label 만 추출)
  headline: string;         // "오늘 시장 상태: 강세장"
  advice: string;           // 1~2 줄 안내 (사용자 명세 §3)
  metrics: string[];        // "KOSPI 60일선 위 · KOSDAQ 60일선 아래 · ..."
  missingData: string[];    // UNKNOWN 일 때 누락 데이터 안내
}

// ───────────────────────────────────────────────────────────────
// 입력 — 사이드카 raw 의 일부
// ───────────────────────────────────────────────────────────────
export interface ScanMarketRaw {
  kospi_above_ma60?: boolean | null;
  kosdaq_above_ma60?: boolean | null;
  kospi_20d_return?: number | null;
  kosdaq_20d_return?: number | null;
  flow?: string | null;
}

export interface ScanSummaryRaw {
  n_chase_risk_strong?: number | null;
  n_candidates_bottom?: number | null;
  n_critical_in_bottom?: number | null;
  stage_counts?: Record<string, number> | null;
}

export interface SectorRegimeRaw {
  market_flow?: string | null;
  sectors_strong?: Array<unknown>;
  sectors_weak?: Array<unknown>;
}

export interface JudgeInput {
  market: ScanMarketRaw | null | undefined;
  summary: ScanSummaryRaw | null | undefined;
  sector: SectorRegimeRaw | null | undefined;
}

// ───────────────────────────────────────────────────────────────
// 핵심: judgeMarketRegime
// ───────────────────────────────────────────────────────────────
export function judgeMarketRegime(input: JudgeInput): MarketRegimeResult {
  const { market, summary, sector } = input;
  const signals: MarketSignal[] = [];
  const missingData: string[] = [];

  // S1. 사이드카 market_flow (가중 5)
  const flow = market?.flow ?? sector?.market_flow ?? null;
  if (flow === '강세 흐름') {
    signals.push({ key: 'flow', label: '사이드카 시장 흐름 강세', score: 5 });
  } else if (flow === '약세 흐름') {
    signals.push({ key: 'flow', label: '사이드카 시장 흐름 약세', score: -5 });
  } else if (flow === '중립 흐름') {
    signals.push({ key: 'flow', label: '사이드카 시장 흐름 중립', score: 0 });
  } else {
    missingData.push('사이드카 market_flow 없음');
  }

  // S2. KOSPI 60일선 위치 (가중 2)
  if (typeof market?.kospi_above_ma60 === 'boolean') {
    if (market.kospi_above_ma60) {
      signals.push({ key: 'kospi_ma60', label: 'KOSPI 60일선 위', score: 2 });
    } else {
      signals.push({ key: 'kospi_ma60', label: 'KOSPI 60일선 아래', score: -2 });
    }
  } else {
    missingData.push('KOSPI 60일선 정보 없음');
  }

  // S3. KOSDAQ 60일선 위치 (가중 2)
  if (typeof market?.kosdaq_above_ma60 === 'boolean') {
    if (market.kosdaq_above_ma60) {
      signals.push({ key: 'kosdaq_ma60', label: 'KOSDAQ 60일선 위', score: 2 });
    } else {
      signals.push({ key: 'kosdaq_ma60', label: 'KOSDAQ 60일선 아래', score: -2 });
    }
  } else {
    missingData.push('KOSDAQ 60일선 정보 없음');
  }

  // S4. KOSPI 20일 수익률
  const kospi20 = typeof market?.kospi_20d_return === 'number' ? market.kospi_20d_return : null;
  if (kospi20 != null) {
    let s = 0;
    if (kospi20 >= 5) s = 3;
    else if (kospi20 >= 2) s = 1;
    else if (kospi20 <= -5) s = -3;
    else if (kospi20 <= -2) s = -1;
    signals.push({ key: 'kospi_20d', label: `KOSPI 20일 ${kospi20 >= 0 ? '+' : ''}${kospi20.toFixed(1)}%`, score: s });
  } else {
    missingData.push('KOSPI 20일 수익률 없음');
  }

  // S5. KOSDAQ 20일 수익률
  const kosdaq20 = typeof market?.kosdaq_20d_return === 'number' ? market.kosdaq_20d_return : null;
  if (kosdaq20 != null) {
    let s = 0;
    if (kosdaq20 >= 5) s = 3;
    else if (kosdaq20 >= 2) s = 1;
    else if (kosdaq20 <= -5) s = -3;
    else if (kosdaq20 <= -2) s = -1;
    signals.push({ key: 'kosdaq_20d', label: `KOSDAQ 20일 ${kosdaq20 >= 0 ? '+' : ''}${kosdaq20.toFixed(1)}%`, score: s });
  } else {
    missingData.push('KOSDAQ 20일 수익률 없음');
  }

  // S6. 강한 섹터 vs 약한 섹터 분포
  const strongCount = Array.isArray(sector?.sectors_strong) ? sector!.sectors_strong!.length : 0;
  const weakCount = Array.isArray(sector?.sectors_weak) ? sector!.sectors_weak!.length : 0;
  if (strongCount + weakCount > 0) {
    const diff = strongCount - weakCount;
    let s = 0;
    if (diff >= 3) s = 1;
    else if (diff <= -3) s = -1;
    signals.push({
      key: 'sector_dist',
      label: `강한 섹터 ${strongCount}개 · 약한 섹터 ${weakCount}개`,
      score: s,
    });
  }

  // S7. 추격 위험 종목 비율 (과열 경고)
  const chaseRisk = typeof summary?.n_chase_risk_strong === 'number' ? summary.n_chase_risk_strong : null;
  if (chaseRisk != null) {
    let s = 0;
    if (chaseRisk >= 40) s = -1;
    signals.push({
      key: 'chase_risk',
      label: `추격 위험 종목 ${chaseRisk}개${chaseRisk >= 40 ? ' (과열 경고)' : ''}`,
      score: s,
    });
  }

  // ── 총점 + Regime 분류
  const totalScore = signals.reduce((a, s) => a + s.score, 0);
  const signalCount = signals.length;

  let regime: MarketRegime;
  if (signalCount < 2) {
    regime = 'UNKNOWN';
  } else if (totalScore >= 9) {
    regime = 'STRONG_BULL';
  } else if (totalScore >= 4) {
    regime = 'MILD_BULL';
  } else if (totalScore >= -3) {
    regime = 'NEUTRAL';
  } else if (totalScore >= -8) {
    regime = 'MILD_BEAR';
  } else {
    regime = 'STRONG_BEAR';
  }

  const display = REGIME_DISPLAY[regime];
  const mode = regimeToMode(regime);
  const modeLabel = MODE_LABEL[mode];

  // 자연어 사유 (점수 영향 있는 시그널만, 상위 5개)
  const reasons = signals
    .filter(s => s.score !== 0)
    .map(s => s.label)
    .slice(0, 5);

  // 메트릭 한 줄 (시그널 모두 압축)
  const metrics = signals.map(s => s.label);

  // 헤드라인 + advice
  const headline = `오늘 시장 상태: ${display}`;
  const advice = buildAdvice(regime);

  return {
    regime,
    display,
    mode,
    modeLabel,
    score: totalScore,
    signals,
    reasons,
    headline,
    advice,
    metrics,
    missingData,
  };
}

// ───────────────────────────────────────────────────────────────
// buildAdvice — 사용자 명세 §3 예시 문구 그대로
// ───────────────────────────────────────────────────────────────
export function buildAdvice(regime: MarketRegime): string {
  switch (regime) {
    case 'STRONG_BULL':
    case 'MILD_BULL':
      return '오늘은 주도주와 후발 강세 후보를 우선 확인하세요. 단, 이미 급등한 종목을 추격매수하지 말고 눌림/재돌파 가격이 명확한 종목만 매매계획을 기록하세요.';
    case 'NEUTRAL':
      return '오늘은 후보를 넓게 보지 말고 1순위만 확인하세요. 거래대금이 붙고 손절가가 명확한 종목만 매매계획을 기록하세요.';
    case 'MILD_BEAR':
    case 'STRONG_BEAR':
      return '오늘은 신규 매수보다 보유종목과 예약매수 대기 종목 점검이 우선입니다. 신규 후보는 손절가가 가까운 종목만 작게 검토하세요.';
    case 'UNKNOWN':
      return '시장 상태 판단에 필요한 데이터가 부족합니다. 보합장(선별) 모드로 동작하며, 1순위만 확인하는 보수적 접근을 추천합니다.';
  }
}

// ───────────────────────────────────────────────────────────────
// GPT 리포트용 한 줄 요약 (§0 섹션에 사용)
// ───────────────────────────────────────────────────────────────
export function regimeReportLines(result: MarketRegimeResult | null): string[] {
  if (!result) {
    return [
      '- **시장 상태:** 판단 보류 (데이터 부족)',
      '- **전략 모드:** 선별 (보합장 가정)',
    ];
  }
  const out: string[] = [];
  out.push(`- **시장 상태:** ${result.display}`);
  out.push(`- **전략 모드:** ${result.modeLabel}`);
  out.push(`- **안내:** ${result.advice}`);
  if (result.reasons.length > 0) {
    out.push(`- **판단 사유:** ${result.reasons.join(' · ')}`);
  }
  if (result.regime === 'UNKNOWN' && result.missingData.length > 0) {
    out.push(`- **부족 데이터:** ${result.missingData.join(' · ')}`);
  }
  return out;
}
