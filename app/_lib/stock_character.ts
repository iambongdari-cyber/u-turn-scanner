// app/_lib/stock_character.ts
// v0.8-3 1순위 종목 5등급 성격 분류
//
// 우선순위 분기 (사용자 명세 §4):
//   1. 위험구간 시장 → WATCH_ONLY
//   2. 컨디션 위험 → WATCH_ONLY
//   3. 이격 과다 → LATE_CHASE_RISK
//   4. 주도 업종 대장주 → LEADING_FOLLOW
//   5. 주도 업종 후발주 → LATE_ENTRY
//   6. 주도 업종 아님 + U턴 조건 좋음 → INDIVIDUAL_UTURN
//   7. 그 외 → WATCH_ONLY

import { BeginnerRow, judgeRow } from './beginner';
import { MarketRegime } from './market_regime';
import { SectorFlow } from './sector_flow';

// 외부 import 회피 — string union
type ConditionStateLite =
  | 'DATA_INSUFFICIENT'
  | 'EXCELLENT'
  | 'GOOD'
  | 'AVERAGE'
  | 'CAUTION'
  | 'DANGER';

// ───────────────────────────────────────────────────────────────
// 5 등급 enum + 라벨
// ───────────────────────────────────────────────────────────────
export type StockCharacter =
  | 'LEADING_FOLLOW'      // 주도주 추종
  | 'LATE_ENTRY'          // 후발주 진입
  | 'INDIVIDUAL_UTURN'    // 개별 U턴 종목
  | 'LATE_CHASE_RISK'     // 끝물 추격 위험
  | 'WATCH_ONLY';         // 관망 대상

export const CHARACTER_LABEL: Record<StockCharacter, string> = {
  LEADING_FOLLOW: '주도주 추종',
  LATE_ENTRY: '후발주 진입',
  INDIVIDUAL_UTURN: '개별 U턴 종목',
  LATE_CHASE_RISK: '끝물 추격 위험',
  WATCH_ONLY: '관망 대상',
};

export const CHARACTER_BADGE_CLASS: Record<StockCharacter, string> = {
  LEADING_FOLLOW: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  LATE_ENTRY: 'bg-sky-100 text-sky-800 border-sky-300',
  INDIVIDUAL_UTURN: 'bg-amber-100 text-amber-900 border-amber-300',
  LATE_CHASE_RISK: 'bg-red-100 text-red-800 border-red-300',
  WATCH_ONLY: 'bg-slate-200 text-slate-700 border-slate-300',
};

// ───────────────────────────────────────────────────────────────
// 결과 인터페이스 (사용자 명세 §2)
// ───────────────────────────────────────────────────────────────
export interface StockCharacterResult {
  character: StockCharacter;
  label: string;
  narrative: string;
  reasoning: string[];
  isActionable: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

// ───────────────────────────────────────────────────────────────
// 입력
// ───────────────────────────────────────────────────────────────
export interface ClassifyInput {
  row: BeginnerRow | null;
  regime: MarketRegime;
  conditionState: ConditionStateLite;
  sectorFlow: SectorFlow | null;
}

// ───────────────────────────────────────────────────────────────
// 헬퍼: 종목이 주도 업종 대장주 안에 있는가
// ───────────────────────────────────────────────────────────────
function isInLeaders(ticker: string, sectorFlow: SectorFlow | null): {
  isLeader: boolean;
  isQuasi: boolean;
  sectorLabel: string | null;
} {
  if (!sectorFlow) return { isLeader: false, isQuasi: false, sectorLabel: null };
  for (const arr of Object.values(sectorFlow.leadersBySector)) {
    const found = arr.find(l => l.ticker === ticker);
    if (found) {
      return {
        isLeader: true,
        isQuasi: found.source === 'QUASI_LEADER',
        sectorLabel: found.sectorLabel,
      };
    }
  }
  return { isLeader: false, isQuasi: false, sectorLabel: null };
}

function isInTopThreeSector(sector: string | null | undefined, sectorFlow: SectorFlow | null): {
  isInTop: boolean;
  sectorLabel: string | null;
  isLeading: boolean;
} {
  if (!sectorFlow || !sector) return { isInTop: false, sectorLabel: null, isLeading: false };
  const found = sectorFlow.topThree.find(s => s.sector === sector);
  if (found) {
    return { isInTop: true, sectorLabel: found.sectorLabel, isLeading: found.isLeading };
  }
  return { isInTop: false, sectorLabel: null, isLeading: false };
}

// ───────────────────────────────────────────────────────────────
// 메인: classifyStockCharacter
// ───────────────────────────────────────────────────────────────
export function classifyStockCharacter(input: ClassifyInput): StockCharacterResult {
  const { row, regime, conditionState, sectorFlow } = input;
  const reasoning: string[] = [];

  // ── 0) 종목 자체 없음 → WATCH_ONLY
  if (!row) {
    return {
      character: 'WATCH_ONLY',
      label: CHARACTER_LABEL.WATCH_ONLY,
      narrative: '오늘 1순위 종목이 없어 신규 진입보다 관망이 우선입니다.',
      reasoning: ['1순위 종목 없음'],
      isActionable: false,
      riskLevel: 'HIGH',
    };
  }

  // ── 1) 시장 위험구간 → WATCH_ONLY
  if (regime === 'DANGER') {
    return {
      character: 'WATCH_ONLY',
      label: CHARACTER_LABEL.WATCH_ONLY,
      narrative: '시장이 위험구간이라 신규 진입보다 관망이 우선입니다.',
      reasoning: ['시장 위험구간'],
      isActionable: false,
      riskLevel: 'HIGH',
    };
  }

  // ── 2) 전략 컨디션 위험 → WATCH_ONLY
  if (conditionState === 'DANGER') {
    return {
      character: 'WATCH_ONLY',
      label: CHARACTER_LABEL.WATCH_ONLY,
      narrative: '전략 컨디션이 위험이므로 신규 진입을 보류해야 합니다.',
      reasoning: ['컨디션 위험'],
      isActionable: false,
      riskLevel: 'HIGH',
    };
  }

  // ── 3) 이격 과다 → LATE_CHASE_RISK
  const disparity = row.disparity_pct ?? null;
  const valueRatio = row.value_ratio ?? null;
  // 거래대금 회복 배수가 매우 높으면 (예: 5배 이상) 단기 과열 신호로도 활용
  if (disparity != null && disparity >= 15) {
    reasoning.push(`이격 +${disparity.toFixed(1)}%`);
    return {
      character: 'LATE_CHASE_RISK',
      label: CHARACTER_LABEL.LATE_CHASE_RISK,
      narrative: '이 종목은 이미 많이 올라 끝물 추격 위험이 있습니다. 내일 신규 진입 대상에서 제외하세요.',
      reasoning,
      isActionable: false,
      riskLevel: 'HIGH',
    };
  }

  const v = judgeRow(row);
  const uturn = v.uturn_passed;

  // sector 일치 확인 (BeginnerRow.sector 가 사이드카 sector 코드/이름)
  const leaderInfo = isInLeaders(row.ticker, sectorFlow);
  const topSectorInfo = isInTopThreeSector(row.sector, sectorFlow);

  // ── 4) 주도 업종 대장주 → LEADING_FOLLOW
  if (leaderInfo.isLeader) {
    reasoning.push(`${leaderInfo.sectorLabel ?? '주도 업종'} 안 ${leaderInfo.isQuasi ? '준대장주' : '대장주'}`);
    if (topSectorInfo.isLeading) reasoning.push('주도 업종 일치');
    if (v.risk === 'LOW') reasoning.push('위험 낮음');
    return {
      character: 'LEADING_FOLLOW',
      label: CHARACTER_LABEL.LEADING_FOLLOW,
      narrative: `이 종목은 ${leaderInfo.sectorLabel ?? '오늘 강한 업종'} 안의 ${leaderInfo.isQuasi ? '준대장주' : '대장주'} 흐름에 있습니다. 시장 흐름과 업종 흐름이 맞습니다.`,
      reasoning,
      isActionable: true,
      riskLevel: v.risk === 'LOW' ? 'LOW' : 'MEDIUM',
    };
  }

  // ── 5) 주도 업종 안의 후발주 → LATE_ENTRY
  if (topSectorInfo.isInTop) {
    reasoning.push(`${topSectorInfo.sectorLabel ?? '강한 업종'} 안 후발 종목`);
    if (topSectorInfo.isLeading) reasoning.push('주도 업종');
    return {
      character: 'LATE_ENTRY',
      label: CHARACTER_LABEL.LATE_ENTRY,
      narrative: `이 종목은 ${topSectorInfo.sectorLabel ?? '강한 업종'} 안의 후발 종목입니다. 대장주 흐름이 유지될 때만 의미가 있습니다.`,
      reasoning,
      isActionable: true,
      riskLevel: 'MEDIUM',
    };
  }

  // ── 6) 주도 업종 아님 + U턴 조건 좋음 → INDIVIDUAL_UTURN
  //   사용자 명세 §4-6: U턴 5조건 중 4 이상 또는 점수 ≥ 70
  //   추가: 거래대금 회복 + 60일선 회복
  const goodUturn = uturn >= 4;
  const goodFlow = row.checks?.value_recovering === true && row.checks?.above_ma60 === true;
  if (goodUturn || goodFlow) {
    reasoning.push(`U턴 ${uturn}/5`);
    if (row.checks?.value_recovering) reasoning.push('거래대금 회복');
    if (row.checks?.above_ma60) reasoning.push('60일선 회복');
    if (v.risk === 'LOW') reasoning.push('위험 낮음');
    return {
      character: 'INDIVIDUAL_UTURN',
      label: CHARACTER_LABEL.INDIVIDUAL_UTURN,
      narrative: '이 종목은 주도 업종은 아니지만 개별 U턴 조건이 좋습니다. 내일 볼 수는 있지만 시장 흐름과 완전히 맞지는 않으므로 비중은 작게 보세요.',
      reasoning,
      isActionable: true,
      riskLevel: v.risk === 'LOW' ? 'MEDIUM' : 'MEDIUM',
    };
  }

  // valueRatio 가 사이드카에 있을 때 추가 안전 — 거래대금 배수 매우 높으면 단기 과열로 LATE_CHASE_RISK 회귀
  if (valueRatio != null && valueRatio >= 8) {
    reasoning.push(`거래대금 회복 ${valueRatio.toFixed(1)}배 (단기 과열 의심)`);
    return {
      character: 'LATE_CHASE_RISK',
      label: CHARACTER_LABEL.LATE_CHASE_RISK,
      narrative: '거래대금이 평소 대비 매우 큰 폭으로 늘어 단기 과열 가능성이 있습니다. 신규 진입 대상에서 제외하세요.',
      reasoning,
      isActionable: false,
      riskLevel: 'HIGH',
    };
  }

  // ── 7) 그 외 → WATCH_ONLY
  reasoning.push(`U턴 ${uturn}/5`);
  reasoning.push('주도 업종 아님');
  return {
    character: 'WATCH_ONLY',
    label: CHARACTER_LABEL.WATCH_ONLY,
    narrative: '시장 흐름과 맞지 않아 내일 행동 대상에서 제외합니다.',
    reasoning,
    isActionable: false,
    riskLevel: 'HIGH',
  };
}
