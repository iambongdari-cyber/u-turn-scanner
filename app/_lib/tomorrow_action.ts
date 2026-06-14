// app/_lib/tomorrow_action.ts
// v0.8-1 내일 행동 지시 빌더
//
// 사용자 명세 §3 그대로:
//  - 위험구간: 신규 진입 금지, 0개
//  - 컨디션 위험: 신규 진입 보류, 0개
//  - 약세장: 0~1개 (LIGHT)
//  - 보합장: 1개 (LIGHT)
//  - 강세장: 1~3개 (NORMAL), 단 보유/예약 있으면 1개

import { MarketRegime, REGIME_DISPLAY } from './market_regime';

// 외부 import 회피 — 컨디션 상태는 union type 으로
type ConditionStateLite =
  | 'DATA_INSUFFICIENT'
  | 'EXCELLENT'
  | 'GOOD'
  | 'AVERAGE'
  | 'CAUTION'
  | 'DANGER';

// v0.8-3 종목 성격 (외부 import 회피)
type StockCharacterLite =
  | 'LEADING_FOLLOW'
  | 'LATE_ENTRY'
  | 'INDIVIDUAL_UTURN'
  | 'LATE_CHASE_RISK'
  | 'WATCH_ONLY';

// ───────────────────────────────────────────────────────────────
// 결과 인터페이스 (사용자 명세 그대로)
// ───────────────────────────────────────────────────────────────
export interface TomorrowAction {
  canEnterNew: boolean;
  maxNewCount: number;
  topPickName: string | null;
  intensity: 'NORMAL' | 'LIGHT' | 'NONE';
  /** 🎯 내일 행동 영역에 표시할 자연어 (3 ~ 5 줄) */
  summaryLines: string[];
  /** 🚫 금지 행동 영역 자연어 (3 ~ 5 줄) */
  mustNotDo: string[];
}

// ───────────────────────────────────────────────────────────────
// 입력
// ───────────────────────────────────────────────────────────────
export interface BuildTomorrowActionInput {
  regime: MarketRegime;
  conditionState: ConditionStateLite;
  topPickName: string | null;
  hasHoldingOrReserved: boolean;
  /** 강세장에서 강한 후보 다수 발견 여부 — selectTradePlanTargets 결과 길이 */
  strongCandidateCount?: number;
  /** v0.8-3 1순위 종목 성격 — 종목 자체 위험 반영 */
  stockCharacter?: StockCharacterLite | null;
}

// ───────────────────────────────────────────────────────────────
// 기본 금지 행동 (사용자 명세 §3 기본값)
// ───────────────────────────────────────────────────────────────
const BASE_MUST_NOT_DO = [
  '손절가 없는 매수 금지',
  '테마주 추격 금지',
  '동시 다종목 매수 금지',
];

// ───────────────────────────────────────────────────────────────
// buildTomorrowAction — main
// ───────────────────────────────────────────────────────────────
export function buildTomorrowAction(input: BuildTomorrowActionInput): TomorrowAction {
  const { regime, conditionState, topPickName, hasHoldingOrReserved, strongCandidateCount, stockCharacter } = input;
  const hasTopPick = topPickName != null;

  // ── 0-a) v0.8-3 종목 성격 LATE_CHASE_RISK → 신규 진입 금지
  if (stockCharacter === 'LATE_CHASE_RISK') {
    return {
      canEnterNew: false,
      maxNewCount: 0,
      topPickName: null,
      intensity: 'NONE',
      summaryLines: [
        '내일은 신규 진입하지 마세요.',
        '1순위 종목이 끝물 추격 위험 구간입니다.',
        '보유종목 점검 및 손절가 재확인 우선.',
      ],
      mustNotDo: [
        ...BASE_MUST_NOT_DO,
        '끝물 추격매수 금지',
      ],
    };
  }

  // ── 0-b) v0.8-3 종목 성격 WATCH_ONLY → 시장 분기로 가되 1순위 미반영
  //   시장 / 컨디션 분기는 그대로 작동 (topPickName 은 null 처리해서 "1순위 종목 없는" 분기로)
  const effectiveTopPickName = stockCharacter === 'WATCH_ONLY' ? null : topPickName;
  const effectiveHasTopPick = effectiveTopPickName != null;

  // ── 1) 위험구간 (DANGER 시장)
  if (regime === 'DANGER') {
    return {
      canEnterNew: false,
      maxNewCount: 0,
      topPickName: null,
      intensity: 'NONE',
      summaryLines: [
        '내일은 신규 진입하지 마세요.',
        '시장 상태가 위험구간입니다.',
        '보유종목 손절가만 점검하세요.',
      ],
      mustNotDo: [
        ...BASE_MUST_NOT_DO,
        '위험구간에서 신규 진입 금지',
      ],
    };
  }

  // ── 2) 전략 컨디션 위험
  if (conditionState === 'DANGER') {
    return {
      canEnterNew: false,
      maxNewCount: 0,
      topPickName: null,
      intensity: 'NONE',
      summaryLines: [
        '전략 컨디션이 위험이므로 신규 진입을 보류하세요.',
        '최근 손실 종목 패턴을 회고하세요.',
        '현금 보유가 오늘의 전략입니다.',
      ],
      mustNotDo: [
        ...BASE_MUST_NOT_DO,
        '컨디션 회복 전 신규 진입 금지',
      ],
    };
  }

  // ── 3) 판단 보류 (UNKNOWN)
  if (regime === 'UNKNOWN') {
    return {
      canEnterNew: effectiveHasTopPick,
      maxNewCount: effectiveHasTopPick ? 1 : 0,
      topPickName: effectiveTopPickName,
      intensity: 'LIGHT',
      summaryLines: effectiveHasTopPick
        ? [
            '시장 흐름 데이터가 부족해 보수적으로 판단합니다.',
            `${effectiveTopPickName} 1 개만 보세요.`,
            '비중은 작게, 손절가 명확하게.',
          ]
        : [
            '시장 흐름 데이터가 부족하고 1순위 종목도 없습니다.',
            '신규 진입보다 관망이 우선입니다.',
          ],
      mustNotDo: BASE_MUST_NOT_DO,
    };
  }

  // ── 4) 약세장 (BEAR)
  if (regime === 'BEAR') {
    if (!effectiveHasTopPick) {
      return {
        canEnterNew: false,
        maxNewCount: 0,
        topPickName: null,
        intensity: 'NONE',
        summaryLines: [
          '내일은 신규 진입보다 보유종목 점검이 우선입니다.',
          '약세장에서는 손절가 이탈 종목을 먼저 정리하세요.',
          '현금 비중을 확대하세요.',
        ],
        mustNotDo: [...BASE_MUST_NOT_DO, '약세장에서 무리한 반등 매수 금지'],
      };
    }
    return {
      canEnterNew: true,
      maxNewCount: 1,
      topPickName: effectiveTopPickName,
      intensity: 'LIGHT',
      summaryLines: [
        `${effectiveTopPickName} 최대 1 개만 작게 검토하세요.`,
        '약세장이므로 손절가가 가까운 종목만.',
        '신규 진입보다 보유종목 점검이 우선입니다.',
      ],
      mustNotDo: [...BASE_MUST_NOT_DO, '약세장에서 무리한 반등 매수 금지'],
    };
  }

  // ── 5) 보합장 (NEUTRAL)
  if (regime === 'NEUTRAL') {
    if (!effectiveHasTopPick) {
      return {
        canEnterNew: false,
        maxNewCount: 0,
        topPickName: null,
        intensity: 'NONE',
        summaryLines: [
          '오늘 1순위로 선정된 종목이 없습니다.',
          '내일은 신규 진입보다 관망이 우선입니다.',
          '예약매수 대기 / 보유종목 점검에 집중하세요.',
        ],
        mustNotDo: BASE_MUST_NOT_DO,
      };
    }
    return {
      canEnterNew: true,
      maxNewCount: 1,
      topPickName: effectiveTopPickName,
      intensity: 'LIGHT',
      summaryLines: [
        `${effectiveTopPickName} 1 개만 보세요.`,
        '보합장이므로 비중은 작게.',
        '예약매수는 1 건만, 손절가 명확하게.',
      ],
      mustNotDo: BASE_MUST_NOT_DO,
    };
  }

  // ── 6) 강세장 (BULL)
  if (regime === 'BULL') {
    // v0.8-3: WATCH_ONLY 차단 후 effectiveTopPickName 가 null 인 경우 처리
    if (!effectiveHasTopPick) {
      return {
        canEnterNew: false,
        maxNewCount: 0,
        topPickName: null,
        intensity: 'NONE',
        summaryLines: [
          '강세장이지만 1순위로 선정된 종목이 없습니다.',
          '내일은 관망이 우선입니다.',
          '추격매수는 금지입니다.',
        ],
        mustNotDo: [...BASE_MUST_NOT_DO, '강세장 막바지 추격매수 금지'],
      };
    }

    // 보유/예약 있으면 최대 1개
    if (hasHoldingOrReserved) {
      return {
        canEnterNew: true,
        maxNewCount: 1,
        topPickName: effectiveTopPickName,
        intensity: 'NORMAL',
        summaryLines: [
          `${effectiveTopPickName} 1 개만 신규로 보세요.`,
          '강세장이지만 보유/예약이 있어 신규는 1 개로 제한.',
          '눌림/재돌파 가격 명확한 종목만, 손절가 -5% 이내.',
        ],
        mustNotDo: [...BASE_MUST_NOT_DO, '추격매수 금지 (이격 12% 이상 보류)'],
      };
    }

    // v0.8-3 종목 성격 — LATE_ENTRY / INDIVIDUAL_UTURN 이면 강세장에서도 최대 1, LIGHT
    if (stockCharacter === 'LATE_ENTRY' || stockCharacter === 'INDIVIDUAL_UTURN') {
      const charLabel = stockCharacter === 'LATE_ENTRY' ? '후발주' : '개별 U턴 종목';
      return {
        canEnterNew: true,
        maxNewCount: 1,
        topPickName: effectiveTopPickName,
        intensity: 'LIGHT',
        summaryLines: [
          `${effectiveTopPickName} 1 개만 작게 검토하세요.`,
          `강세장이지만 1순위가 ${charLabel}이라 신규는 1 개로 제한.`,
          '손절가 -5% 이내 명확하게.',
        ],
        mustNotDo: [...BASE_MUST_NOT_DO, '추격매수 금지 (이격 12% 이상 보류)'],
      };
    }

    // 강한 후보가 여럿 있으면 최대 3개 — LEADING_FOLLOW 인 경우만 캡 확대
    const cap = strongCandidateCount && strongCandidateCount >= 2
      ? Math.min(strongCandidateCount, 3)
      : 1;
    return {
      canEnterNew: true,
      maxNewCount: cap,
      topPickName: effectiveTopPickName,
      intensity: 'NORMAL',
      summaryLines: cap >= 2
        ? [
            `${effectiveTopPickName} 등 최대 ${cap} 종목 검토 가능.`,
            '강세장이므로 주도주 / 후발 강세 후보 우선.',
            '눌림/재돌파 가격 명확한 종목만, 손절가 -5% 이내.',
          ]
        : [
            `${effectiveTopPickName} 1 개를 우선 검토.`,
            '강세장 흐름이지만 추격은 금지.',
            '눌림/재돌파 가격 명확하게, 손절가 -5% 이내.',
          ],
      mustNotDo: [...BASE_MUST_NOT_DO, '추격매수 금지 (이격 12% 이상 보류)'],
    };
  }

  // ── 안전 fallback (도달 X)
  return {
    canEnterNew: false,
    maxNewCount: 0,
    topPickName: null,
    intensity: 'NONE',
    summaryLines: [`시장 상태 판단: ${REGIME_DISPLAY[regime]}`, '내일은 관망이 우선입니다.'],
    mustNotDo: BASE_MUST_NOT_DO,
  };
}

// ───────────────────────────────────────────────────────────────
// 한 줄 헤드라인 (간이 — 보고서/GPT 리포트용)
// ───────────────────────────────────────────────────────────────
export function tomorrowHeadline(action: TomorrowAction): string {
  if (!action.canEnterNew) return '내일은 신규 진입 보류 — 보유종목 점검 / 관망 우선';
  if (action.maxNewCount === 1) return `내일은 ${action.topPickName ?? '1순위'} 1 개만 검토`;
  return `내일은 최대 ${action.maxNewCount} 종목 검토 가능 (${action.topPickName ?? '1순위 외'})`;
}
