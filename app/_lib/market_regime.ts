// app/_lib/market_regime.ts
// v0.6 장세 판단 + 전략 모드 (4단계 통일)
//
// 변경 (v0.5 → v0.6):
// - 5단계 (STRONG_BULL/MILD_BULL/NEUTRAL/MILD_BEAR/STRONG_BEAR) → 4단계 (BULL/NEUTRAL/BEAR/DANGER)
// - 전략 모드 3개 (AGGRESSIVE/SELECTIVE/DEFENSIVE) → 4개 (+ HOLD_CASH)
// - displayScore 4단계 명시적 임계:
//     80~100 강세장 (공격)
//     60~79  보합장 (선별)
//     40~59  약세장 (방어)
//      0~39  위험구간 (관망)
// - 신규: buildCorePhrase (핵심 문장) + buildConclusionText (자연어 코치 결론)
// - 신규: REGIME_ATTITUDE (오늘의 태도 라벨)

// ───────────────────────────────────────────────────────────────
// 내부 4단계 enum + UNKNOWN
// ───────────────────────────────────────────────────────────────
export type MarketRegime =
  | 'BULL'
  | 'NEUTRAL'
  | 'BEAR'
  | 'DANGER'
  | 'UNKNOWN';

// 사용자 표시 4단계
export type RegimeDisplay = '강세장' | '보합장' | '약세장' | '위험구간' | '판단 보류';

export const REGIME_DISPLAY: Record<MarketRegime, RegimeDisplay> = {
  BULL: '강세장',
  NEUTRAL: '보합장',
  BEAR: '약세장',
  DANGER: '위험구간',
  UNKNOWN: '판단 보류',
};

export const REGIME_BADGE_CLASS: Record<MarketRegime, string> = {
  BULL: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  NEUTRAL: 'bg-slate-100 text-slate-700 border-slate-300',
  BEAR: 'bg-amber-100 text-amber-800 border-amber-300',
  DANGER: 'bg-red-100 text-red-800 border-red-300',
  UNKNOWN: 'bg-slate-50 text-slate-500 border-slate-200',
};

export const REGIME_SECTION_CLASS: Record<MarketRegime, string> = {
  BULL: 'border-emerald-300 bg-emerald-50/40',
  NEUTRAL: 'border-slate-200 bg-slate-50/40',
  BEAR: 'border-amber-300 bg-amber-50/40',
  DANGER: 'border-red-300 bg-red-50/40',
  UNKNOWN: 'border-slate-200 bg-slate-50/30',
};

// ───────────────────────────────────────────────────────────────
// 전략 모드 (4개)
// ───────────────────────────────────────────────────────────────
export type RegimeMode = 'AGGRESSIVE' | 'SELECTIVE' | 'DEFENSIVE' | 'HOLD_CASH';

export const MODE_LABEL: Record<RegimeMode, string> = {
  AGGRESSIVE: '공격',
  SELECTIVE: '선별',
  DEFENSIVE: '방어',
  HOLD_CASH: '관망',
};

export const MODE_BADGE_CLASS: Record<RegimeMode, string> = {
  AGGRESSIVE: 'bg-emerald-100 text-emerald-800',
  SELECTIVE: 'bg-slate-200 text-slate-800',
  DEFENSIVE: 'bg-amber-100 text-amber-900',
  HOLD_CASH: 'bg-red-100 text-red-800',
};

// 오늘의 태도 — 사용자 명세 "오늘의 태도: 선별 매매" 형식
export const REGIME_ATTITUDE: Record<RegimeMode, string> = {
  AGGRESSIVE: '공격 매매',
  SELECTIVE: '선별 매매',
  DEFENSIVE: '방어 매매',
  HOLD_CASH: '관망',
};

export function regimeToMode(r: MarketRegime): RegimeMode {
  switch (r) {
    case 'BULL': return 'AGGRESSIVE';
    case 'NEUTRAL': return 'SELECTIVE';
    case 'BEAR': return 'DEFENSIVE';
    case 'DANGER': return 'HOLD_CASH';
    case 'UNKNOWN': return 'SELECTIVE'; // 보합장 가정
  }
}

// ───────────────────────────────────────────────────────────────
// 시그널 + 결과 인터페이스
// ───────────────────────────────────────────────────────────────
export interface MarketSignal {
  key: string;
  label: string;
  score: number;
}

export interface MarketRegimeResult {
  regime: MarketRegime;
  display: RegimeDisplay;
  mode: RegimeMode;
  modeLabel: string;
  attitude: string;                 // 오늘의 태도 (예: "선별 매매")
  score: number;                    // raw -16 ~ +16
  displayScore: number | null;      // 0~100 사용자 표시 점수
  signals: MarketSignal[];
  reasons: string[];
  headline: string;
  advice: string;
  corePhrase: string;               // 핵심 문장 (예: "강한 종목만 선별해야 하는 날입니다.")
  conclusionText: string;           // 자연어 결론 2~3 줄
  metrics: string[];
  missingData: string[];
  recommendedActions: string[];
  forbiddenActions: string[];
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
  /** 1순위 종목명 — buildConclusionText 에 사용 */
  topPickName?: string | null;
}

// ───────────────────────────────────────────────────────────────
// raw 점수 → displayScore (0~100) 비대칭 매핑
//  raw +9 이상  → 80~100 (강세장)
//  raw -3 ~ +8  → 60~79  (보합장)
//  raw -8 ~ -4  → 40~59  (약세장)
//  raw -9 이하  →  0~39  (위험구간)
// ───────────────────────────────────────────────────────────────
function rawToDisplayScore(raw: number): number {
  if (raw >= 9) return Math.min(100, 80 + Math.round((raw - 9) * 2.86));
  if (raw >= -3) return Math.round(60 + (raw + 3) * (19 / 11));
  if (raw >= -8) return Math.round(40 + (raw + 8) * (19 / 5));
  return Math.max(0, Math.round(39 + (raw + 9) * (39 / 7)));
}

function displayScoreToRegime(score: number): MarketRegime {
  if (score >= 80) return 'BULL';
  if (score >= 60) return 'NEUTRAL';
  if (score >= 40) return 'BEAR';
  return 'DANGER';
}

// ───────────────────────────────────────────────────────────────
// 핵심: judgeMarketRegime
// ───────────────────────────────────────────────────────────────
export function judgeMarketRegime(input: JudgeInput): MarketRegimeResult {
  const { market, summary, sector, topPickName } = input;
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
    signals.push({
      key: 'kospi_ma60',
      label: market.kospi_above_ma60 ? 'KOSPI 60일선 위' : 'KOSPI 60일선 아래',
      score: market.kospi_above_ma60 ? 2 : -2,
    });
  } else {
    missingData.push('KOSPI 60일선 정보 없음');
  }

  // S3. KOSDAQ 60일선 위치
  if (typeof market?.kosdaq_above_ma60 === 'boolean') {
    signals.push({
      key: 'kosdaq_ma60',
      label: market.kosdaq_above_ma60 ? 'KOSDAQ 60일선 위' : 'KOSDAQ 60일선 아래',
      score: market.kosdaq_above_ma60 ? 2 : -2,
    });
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

  // S7. 추격 위험 종목 비율
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
  let displayScore: number | null;
  if (signalCount < 2) {
    regime = 'UNKNOWN';
    displayScore = null;
  } else {
    displayScore = rawToDisplayScore(totalScore);
    regime = displayScoreToRegime(displayScore);
  }

  const display = REGIME_DISPLAY[regime];
  const mode = regimeToMode(regime);
  const modeLabel = MODE_LABEL[mode];
  const attitude = REGIME_ATTITUDE[mode];

  const reasons = signals.filter(s => s.score !== 0).map(s => s.label).slice(0, 5);
  const metrics = signals.map(s => s.label);

  const headline = `오늘 시장 상태: ${display}`;
  const advice = buildAdvice(regime);
  const corePhrase = buildCorePhrase(regime);
  const conclusionText = buildConclusionText(regime, mode, topPickName ?? null);

  return {
    regime,
    display,
    mode,
    modeLabel,
    attitude,
    score: totalScore,
    displayScore,
    signals,
    reasons,
    headline,
    advice,
    corePhrase,
    conclusionText,
    metrics,
    missingData,
    recommendedActions: buildRecommendedActions(regime),
    forbiddenActions: buildForbiddenActions(regime),
  };
}

// ───────────────────────────────────────────────────────────────
// 자연어 안내 (1~2 줄)
// ───────────────────────────────────────────────────────────────
export function buildAdvice(regime: MarketRegime): string {
  switch (regime) {
    case 'BULL':
      return '오늘은 주도주와 후발 강세 후보를 우선 확인하세요. 단, 이미 급등한 종목을 추격매수하지 말고 눌림/재돌파 가격이 명확한 종목만 매매계획을 기록하세요.';
    case 'NEUTRAL':
      return '오늘은 후보를 넓게 보지 말고 1순위만 확인하세요. 거래대금이 붙고 손절가가 명확한 종목만 매매계획을 기록하세요.';
    case 'BEAR':
      return '오늘은 신규 매수보다 보유종목과 예약매수 대기 종목 점검이 우선입니다. 신규 후보는 손절가가 가까운 종목만 작게 검토하세요.';
    case 'DANGER':
      return '오늘은 신규 매수를 보류하고 보유종목의 위험을 점검하세요. 현금 보유를 최우선으로 합니다.';
    case 'UNKNOWN':
      return '시장 상태 판단에 필요한 데이터가 부족합니다. 보합장(선별) 모드로 동작하며, 1순위만 확인하는 보수적 접근을 추천합니다.';
  }
}

// ───────────────────────────────────────────────────────────────
// 핵심 문장 (사용자 명세 §0)
// ───────────────────────────────────────────────────────────────
export function buildCorePhrase(regime: MarketRegime): string {
  switch (regime) {
    case 'BULL': return '주도주 추세 추종이 가능한 날입니다.';
    case 'NEUTRAL': return '강한 종목만 선별해야 하는 날입니다.';
    case 'BEAR': return '신규진입보다 방어가 우선인 날입니다.';
    case 'DANGER': return '현금 보유가 가장 중요한 날입니다.';
    case 'UNKNOWN': return '보합장 가정으로 보수적으로 접근하는 날입니다.';
  }
}

// ───────────────────────────────────────────────────────────────
// 자연어 결론 (사용자 명세 §0 — 2~3 줄)
// ───────────────────────────────────────────────────────────────
export function buildConclusionText(
  regime: MarketRegime,
  mode: RegimeMode,
  topPickName: string | null,
): string {
  if (regime === 'DANGER') {
    return '오늘은 신규 매수를 보류하고 보유종목의 위험을 점검하세요.\n현금 비중을 최우선으로 유지하세요.';
  }
  if (regime === 'BEAR') {
    return '오늘은 보유종목과 예약매수 대기 종목 점검이 우선입니다.\n신규 진입은 손절가가 가까운 종목만 작게 검토하세요.\n현금 비중을 확대하세요.';
  }
  if (regime === 'BULL') {
    if (!topPickName) {
      return '오늘은 강세장 흐름이지만 매매계획 기록 대상이 없습니다.\n신규 진입보다 관망이 우선입니다.';
    }
    return `${topPickName}을(를) 포함한 주도주/후발 강세 후보를 우선 확인하세요.\n눌림/재돌파 가격이 명확한 종목만 진입하고, 손절가는 반드시 기록하세요.\n현금 비중은 일부 축소 가능합니다.`;
  }
  if (regime === 'NEUTRAL') {
    if (!topPickName) {
      return '오늘은 신규 진입보다 관망이 우선입니다.\n예약매수 대기 / 보유종목 점검에 집중하세요.';
    }
    return `오늘은 ${topPickName} 1개만 검토하세요.\n예약매수는 최대 1건만 허용하고,\n현금 비중 50% 이상을 유지하세요.`;
  }
  // UNKNOWN
  if (!topPickName) {
    return '시장 데이터가 부족하고 매매계획 기록 대상도 없습니다.\n오늘은 신규 진입보다 관망이 우선입니다.';
  }
  return `시장 데이터가 부족하므로 보수적으로 ${topPickName} 1개만 검토하세요.\n현금 비중 50% 이상을 유지하세요.`;
}

// ───────────────────────────────────────────────────────────────
// 추천 행동 (사용자 명세 §3) — 4단계
// ───────────────────────────────────────────────────────────────
export function buildRecommendedActions(regime: MarketRegime): string[] {
  switch (regime) {
    case 'BULL':
      return [
        '주도주 중심으로 확인',
        '예약매수 2~3건까지 허용',
        '현금 비중 축소 가능',
        '손절가 기록 필수',
      ];
    case 'NEUTRAL':
      return [
        '강한 종목 1개만 검토',
        '예약매수 최대 1건',
        '현금 비중 50% 이상 유지',
        '손절가 명확한 종목만 기록',
      ];
    case 'BEAR':
      return [
        '신규진입 최소화',
        '보유종목 점검 우선',
        '현금 비중 확대',
        '무리한 반등 매수 금지',
      ];
    case 'DANGER':
      return [
        '신규진입 금지',
        '보유종목 위험 점검',
        '현금 최우선',
        '매매보다 관망 우선',
      ];
    case 'UNKNOWN':
      return [
        '보합장 가정으로 보수적 접근',
        '1순위만 확인',
        '현금 비중 50% 이상 유지',
      ];
  }
}

// ───────────────────────────────────────────────────────────────
// 금지 행동 (사용자 명세 §4) — 4단계
// ───────────────────────────────────────────────────────────────
export function buildForbiddenActions(regime: MarketRegime): string[] {
  switch (regime) {
    case 'BULL':
      return [
        '계획 없는 추격매수',
        '손절가 없는 진입',
        '급등주 몰빵',
      ];
    case 'NEUTRAL':
      return [
        '후보 전체 훑기',
        '신규 예약매수 여러 개 넣기',
        '테마주 추격',
        '손절가 없는 매수',
      ];
    case 'BEAR':
      return [
        '물타기',
        '반등 기대 매수',
        '손실 종목 방치',
        '무리한 신규진입',
      ];
    case 'DANGER':
      return [
        '신규 매수',
        '레버리지성 매매',
        '손절 회피',
        '감정적 복수매매',
      ];
    case 'UNKNOWN':
      return [
        '후보 전체 훑기',
        '손절가 없는 매수',
        '동시 다종목 진입',
      ];
  }
}

// ───────────────────────────────────────────────────────────────
// GPT 리포트용 라인 빌더
// ───────────────────────────────────────────────────────────────
export function regimeReportLines(result: MarketRegimeResult | null): string[] {
  if (!result) {
    return [
      '- **시장 상태:** 판단 보류 (데이터 부족)',
      '- **전략 모드:** 선별 (보합장 가정)',
    ];
  }
  const out: string[] = [];
  const scoreSuffix = result.displayScore != null ? ` (${result.displayScore}점)` : '';
  out.push(`- **시장 상태:** ${result.display}${scoreSuffix}`);
  out.push(`- **전략 모드:** ${result.modeLabel}`);
  if (result.reasons.length > 0) {
    out.push(`- **판단 사유:** ${result.reasons.join(' · ')}`);
  }
  out.push('- **점수 기준:** 80~100 강세장 / 60~79 보합장 / 40~59 약세장 / 0~39 위험구간');
  if (result.regime === 'UNKNOWN' && result.missingData.length > 0) {
    out.push(`- **부족 데이터:** ${result.missingData.join(' · ')}`);
  }
  return out;
}

// 결론 §0 용 라인
export function conclusionReportLines(result: MarketRegimeResult | null): string[] {
  if (!result) {
    return [
      '시장 상태 판단 데이터가 부족합니다. 보수적으로 접근하세요.',
    ];
  }
  const out: string[] = [];
  out.push(`**오늘의 태도:** ${result.attitude}`);
  if (result.displayScore != null) {
    out.push(`**시장 상태:** ${result.display} ${result.displayScore}점`);
  } else {
    out.push(`**시장 상태:** ${result.display}`);
  }
  out.push(`**전략 모드:** ${result.modeLabel}`);
  out.push('');
  for (const line of result.conclusionText.split('\n')) out.push(line);
  out.push('');
  out.push(`> ${result.corePhrase}`);
  return out;
}
