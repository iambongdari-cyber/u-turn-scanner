// app/_lib/strategy_condition.ts
// v0.6 전략 컨디션 — 구조만 정의, 실제 계산은 v0.8+
//
// 핵심:
// - v0.6 에서는 매매 결과 데이터가 없으므로 항상 DATA_INSUFFICIENT 반환
// - v0.7 에서 매매 결과 기록 기능 추가
// - v0.8 에서 최근 20회 매매 결과 기반 실계산

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

// 등급 임계 (v0.8 실계산 시 사용)
export const STATE_THRESHOLDS = {
  EXCELLENT_MIN_WIN_RATE: 70,
  GOOD_MIN_WIN_RATE: 60,
  AVERAGE_MIN_WIN_RATE: 50,
  CAUTION_MIN_WIN_RATE: 40,
} as const;

// 분석 윈도우
export const WINDOW_SIZE = 20;          // 최근 N회 매매로 평가
export const MIN_COUNT_FOR_CALC = 5;    // 최소 N건 누적 필요

// ───────────────────────────────────────────────────────────────
// 결과 인터페이스
// ───────────────────────────────────────────────────────────────
export interface StrategyConditionResult {
  state: StrategyConditionState;
  stateLabel: string;
  windowSize: number;            // 분석 대상 매매 횟수 (목표 20)
  actualCount: number;           // 실제 누적된 종결 매매 수 (v0.6 = 0)
  winRate: number | null;        // 0~100 (%)
  avgGainPct: number | null;     // 평균 수익률
  avgLossPct: number | null;     // 평균 손실률
  expectedReturnPct: number | null; // 기대수익 (winRate * avgGain - (1-winRate) * avgLoss)
  advice: string;                // 코치 톤 한 줄
  futureItems: string[];         // v0.6 안내용 — 향후 표시 항목
}

// ───────────────────────────────────────────────────────────────
// v0.6 평가 — 항상 DATA_INSUFFICIENT
// v0.8 에서 실계산 로직으로 확장될 자리
// ───────────────────────────────────────────────────────────────
export function evaluateStrategyCondition(
  plans: TradePlan[],
): StrategyConditionResult {
  // v0.6 에서는 closed_pnl_pct 같은 결과 필드가 TradePlan 에 없으므로
  // 종결 매매 수만 카운트 (v0.7 에서 결과 입력 모달 추가 시 본격적으로 사용)
  const closed = plans.filter(p => p.status === 'CLOSED');
  const actualCount = closed.length;

  // v0.6 핵심: 항상 DATA_INSUFFICIENT (계산 안 함)
  return {
    state: 'DATA_INSUFFICIENT',
    stateLabel: STATE_LABEL.DATA_INSUFFICIENT,
    windowSize: WINDOW_SIZE,
    actualCount,
    winRate: null,
    avgGainPct: null,
    avgLossPct: null,
    expectedReturnPct: null,
    advice: actualCount === 0
      ? '아직 종결된 매매가 없습니다. 매매 결과가 누적되면 승률·기대수익을 표시합니다.'
      : `종결 매매 ${actualCount}건 누적 중. ${WINDOW_SIZE}건 이상 누적되면 승률·기대수익을 계산합니다.`,
    futureItems: [
      '최근 20회 매매 승률',
      '평균 수익률',
      '평균 손실률',
      '기대수익',
      '전략 상태: 매우 좋음 / 좋음 / 보통 / 주의 / 위험',
    ],
  };
}

// ───────────────────────────────────────────────────────────────
// GPT 리포트 §2 용 라인
// ───────────────────────────────────────────────────────────────
export function strategyConditionReportLines(result: StrategyConditionResult): string[] {
  const out: string[] = [];
  out.push(`- **상태:** ${result.stateLabel}`);
  out.push(`- **누적 매매:** ${result.actualCount}건 (목표 ${result.windowSize}건)`);
  out.push(`- **안내:** ${result.advice}`);
  if (result.state === 'DATA_INSUFFICIENT') {
    out.push('- **계산 예정 항목:**');
    for (const item of result.futureItems) out.push(`  - ${item}`);
  } else {
    if (result.winRate != null) out.push(`- **승률:** ${result.winRate.toFixed(1)}%`);
    if (result.avgGainPct != null) out.push(`- **평균 수익률:** +${result.avgGainPct.toFixed(1)}%`);
    if (result.avgLossPct != null) out.push(`- **평균 손실률:** -${Math.abs(result.avgLossPct).toFixed(1)}%`);
    if (result.expectedReturnPct != null) {
      const sign = result.expectedReturnPct >= 0 ? '+' : '';
      out.push(`- **기대수익:** ${sign}${result.expectedReturnPct.toFixed(2)}%`);
    }
  }
  return out;
}
