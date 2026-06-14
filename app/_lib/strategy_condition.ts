// app/_lib/strategy_condition.ts
// v0.7 전략 컨디션 — 실계산 (승률·기대수익·등급·신뢰도)
//
// 변경 (v0.6 → v0.7):
// - DATA_INSUFFICIENT 만 반환했던 stub → 실수치 계산
// - 등급 5단계 (EXCELLENT / GOOD / AVERAGE / CAUTION / DANGER)
// - 신뢰도 4단계 (NONE / LOW / MEDIUM / HIGH) — 사용자 요구사항

import { TradePlan } from './trade_plan';

// ───────────────────────────────────────────────────────────────
// 상태 enum
// ───────────────────────────────────────────────────────────────
export type StrategyConditionState =
  | 'DATA_INSUFFICIENT'
  | 'EXCELLENT'
  | 'GOOD'
  | 'AVERAGE'
  | 'CAUTION'
  | 'DANGER';

export const STATE_LABEL: Record<StrategyConditionState, string> = {
  DATA_INSUFFICIENT: '데이터 부족',
  EXCELLENT: '매우 좋음',
  GOOD: '좋음',
  AVERAGE: '보통',
  CAUTION: '주의',
  DANGER: '위험',
};

export const STATE_BADGE_CLASS: Record<StrategyConditionState, string> = {
  DATA_INSUFFICIENT: 'bg-slate-100 text-slate-700 border-slate-300',
  EXCELLENT: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  GOOD: 'bg-sky-100 text-sky-800 border-sky-300',
  AVERAGE: 'bg-slate-200 text-slate-800 border-slate-300',
  CAUTION: 'bg-amber-100 text-amber-900 border-amber-300',
  DANGER: 'bg-red-100 text-red-800 border-red-300',
};

// ───────────────────────────────────────────────────────────────
// 신뢰도 enum (사용자 요구사항)
// 0~4건  = NONE  (계산 안 함)
// 5~9건  = LOW   (낮음)
// 10~19건 = MEDIUM (보통)
// 20+    = HIGH  (높음)
// ───────────────────────────────────────────────────────────────
export type ConfidenceLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  NONE: '계산 안 함',
  LOW: '낮음',
  MEDIUM: '보통',
  HIGH: '높음',
};

export const CONFIDENCE_BADGE_CLASS: Record<ConfidenceLevel, string> = {
  NONE: 'bg-slate-100 text-slate-500 border-slate-200',
  LOW: 'bg-amber-50 text-amber-800 border-amber-200',
  MEDIUM: 'bg-sky-50 text-sky-800 border-sky-200',
  HIGH: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

export function deriveConfidence(actualCount: number): ConfidenceLevel {
  if (actualCount < 5) return 'NONE';
  if (actualCount < 10) return 'LOW';
  if (actualCount < 20) return 'MEDIUM';
  return 'HIGH';
}

// ───────────────────────────────────────────────────────────────
// 상수
// ───────────────────────────────────────────────────────────────
export const STATE_THRESHOLDS = {
  EXCELLENT_MIN_WIN_RATE: 70,
  GOOD_MIN_WIN_RATE: 60,
  AVERAGE_MIN_WIN_RATE: 50,
  CAUTION_MIN_WIN_RATE: 40,
} as const;

export const WINDOW_SIZE = 20;          // 최근 N회 매매로 평가
export const MIN_COUNT_FOR_CALC = 5;    // 최소 N건 누적 필요

// ───────────────────────────────────────────────────────────────
// 결과 인터페이스
// ───────────────────────────────────────────────────────────────
export interface StrategyConditionResult {
  state: StrategyConditionState;
  stateLabel: string;
  confidence: ConfidenceLevel;          // v0.7 신규
  confidenceLabel: string;              // v0.7 신규
  windowSize: number;
  actualCount: number;                  // 실제 누적된 종결+결과입력 매매 수
  totalClosedCount: number;             // 전체 CLOSED 수 (결과 미입력 포함)
  winRate: number | null;               // 0~100 (%)
  avgGainPct: number | null;            // 평균 수익률 (양수만)
  avgLossPct: number | null;            // 평균 손실률 (음수 또는 0)
  expectedReturnPct: number | null;     // 기대수익 (% 단위)
  advice: string;
  futureItems: string[];                // 데이터 부족 시 향후 표시 항목
}

// ───────────────────────────────────────────────────────────────
// v0.7 실계산
// ───────────────────────────────────────────────────────────────
export function evaluateStrategyCondition(plans: TradePlan[]): StrategyConditionResult {
  const allClosed = plans.filter(p => p.status === 'CLOSED');
  const totalClosedCount = allClosed.length;

  // 결과 입력된 CLOSED 만 계산 대상
  const closedWithResult = allClosed
    .filter(p => p.closed_pnl_pct != null)
    .sort((a, b) => {
      // 종료일 내림차순 (최근부터)
      const da = a.closed_at_date ?? a.closed_at ?? '';
      const db = b.closed_at_date ?? b.closed_at ?? '';
      return db.localeCompare(da);
    })
    .slice(0, WINDOW_SIZE);

  const actualCount = closedWithResult.length;
  const confidence = deriveConfidence(actualCount);

  // 5건 미만 → DATA_INSUFFICIENT
  if (actualCount < MIN_COUNT_FOR_CALC) {
    return {
      state: 'DATA_INSUFFICIENT',
      stateLabel: STATE_LABEL.DATA_INSUFFICIENT,
      confidence,
      confidenceLabel: CONFIDENCE_LABEL[confidence],
      windowSize: WINDOW_SIZE,
      actualCount,
      totalClosedCount,
      winRate: null,
      avgGainPct: null,
      avgLossPct: null,
      expectedReturnPct: null,
      advice: actualCount === 0
        ? '아직 종결된 매매 결과가 없습니다. 매매 결과가 누적되면 승률·기대수익을 표시합니다.'
        : `종결 매매 결과 ${actualCount}건 누적 — 최소 ${MIN_COUNT_FOR_CALC}건 이상부터 계산합니다.`,
      futureItems: [
        '최근 20회 매매 승률',
        '평균 수익률',
        '평균 손실률',
        '기대수익',
        '전략 상태: 매우 좋음 / 좋음 / 보통 / 주의 / 위험',
      ],
    };
  }

  // ── 실계산
  const wins = closedWithResult.filter(p => (p.closed_pnl_pct ?? 0) > 0);
  const losses = closedWithResult.filter(p => (p.closed_pnl_pct ?? 0) <= 0);

  const winRate = wins.length / closedWithResult.length * 100;
  const avgGainPct = wins.length > 0
    ? wins.reduce((s, p) => s + (p.closed_pnl_pct ?? 0), 0) / wins.length
    : 0;
  const avgLossPct = losses.length > 0
    ? losses.reduce((s, p) => s + (p.closed_pnl_pct ?? 0), 0) / losses.length
    : 0;

  // 기대수익 = 승률 × 평균수익 + (1-승률) × 평균손실
  //   avgLossPct 는 음수이므로 그대로 더하면 됨
  const expectedReturnPct = (winRate / 100) * avgGainPct + ((100 - winRate) / 100) * avgLossPct;

  // ── 등급
  let state: StrategyConditionState;
  if (winRate >= STATE_THRESHOLDS.EXCELLENT_MIN_WIN_RATE) state = 'EXCELLENT';
  else if (winRate >= STATE_THRESHOLDS.GOOD_MIN_WIN_RATE) state = 'GOOD';
  else if (winRate >= STATE_THRESHOLDS.AVERAGE_MIN_WIN_RATE) state = 'AVERAGE';
  else if (winRate >= STATE_THRESHOLDS.CAUTION_MIN_WIN_RATE) state = 'CAUTION';
  else state = 'DANGER';

  // 보정: 승률 좋아도 기대수익 음수면 CAUTION 강등
  if ((state === 'GOOD' || state === 'AVERAGE') && expectedReturnPct < 0) {
    state = 'CAUTION';
  }

  return {
    state,
    stateLabel: STATE_LABEL[state],
    confidence,
    confidenceLabel: CONFIDENCE_LABEL[confidence],
    windowSize: WINDOW_SIZE,
    actualCount,
    totalClosedCount,
    winRate,
    avgGainPct,
    avgLossPct,
    expectedReturnPct,
    advice: buildConditionAdvice(state, confidence, actualCount, totalClosedCount),
    futureItems: [],
  };
}

// ───────────────────────────────────────────────────────────────
// 코치 advice 5종 (등급별)
// ───────────────────────────────────────────────────────────────
function buildConditionAdvice(
  state: StrategyConditionState,
  confidence: ConfidenceLevel,
  actualCount: number,
  totalClosedCount: number,
): string {
  let core = '';
  switch (state) {
    case 'EXCELLENT':
      core = '전략이 매우 잘 작동하고 있습니다. 현 모드 유지 + 진입 강도 살짝 상향 가능.';
      break;
    case 'GOOD':
      core = '전략이 잘 작동 중. 시장 모드 추천대로 진행하세요.';
      break;
    case 'AVERAGE':
      core = '평균 수준. 손절 원칙을 더 엄격하게 — 평균손실 폭을 줄이는 게 우선입니다.';
      break;
    case 'CAUTION':
      core = '승률 또는 기대수익이 흔들립니다. 신규 진입 강도 하향, 보유종목 점검 우선.';
      break;
    case 'DANGER':
      core = '전략이 작동하지 않는 구간입니다. 신규 진입 보류 + 최근 손실 종목 패턴 회고 필요.';
      break;
    default:
      core = '';
  }
  // 신뢰도 부가 안내
  let confidenceNote = '';
  if (confidence === 'LOW') {
    confidenceNote = ` (신뢰도 낮음 — ${actualCount}건만 누적, 추세 변동 가능)`;
  } else if (confidence === 'MEDIUM') {
    confidenceNote = ` (신뢰도 보통 — ${actualCount}/${WINDOW_SIZE}건 누적)`;
  } else if (confidence === 'HIGH') {
    confidenceNote = ` (신뢰도 높음 — 최근 ${WINDOW_SIZE}건 기준)`;
  }
  // 결과 미입력 안내
  const missing = totalClosedCount - actualCount;
  let missingNote = '';
  if (missing > 0) {
    missingNote = `\n※ 매도완료 ${missing}건은 결과 미입력 상태 (계산 대상에서 제외).`;
  }
  return core + confidenceNote + missingNote;
}

// ───────────────────────────────────────────────────────────────
// GPT 리포트 §2 용 라인
// ───────────────────────────────────────────────────────────────
export function strategyConditionReportLines(result: StrategyConditionResult): string[] {
  const out: string[] = [];
  out.push(`- **상태:** ${result.stateLabel}`);
  out.push(`- **신뢰도:** ${result.confidenceLabel}`);
  out.push(`- **누적 매매:** ${result.actualCount}건 (목표 ${result.windowSize}건)`);
  if (result.state === 'DATA_INSUFFICIENT') {
    out.push(`- **안내:** ${result.advice}`);
    out.push('- **계산 예정 항목:**');
    for (const item of result.futureItems) out.push(`  - ${item}`);
  } else {
    if (result.winRate != null) out.push(`- **승률:** ${result.winRate.toFixed(1)}%`);
    if (result.avgGainPct != null) out.push(`- **평균 수익률:** +${result.avgGainPct.toFixed(1)}%`);
    if (result.avgLossPct != null) out.push(`- **평균 손실률:** ${result.avgLossPct.toFixed(1)}%`);
    if (result.expectedReturnPct != null) {
      const sign = result.expectedReturnPct >= 0 ? '+' : '';
      out.push(`- **기대수익:** ${sign}${result.expectedReturnPct.toFixed(2)}%`);
    }
    out.push(`- **안내:** ${result.advice}`);
  }
  return out;
}
