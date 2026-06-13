// app/_lib/scoring.ts
// v0.4 매매 계획 — 예약매수 의견 / 보유 의견 / 추가매수 체크 / 기본값 제안
//
// ※ 모든 판단은 "개인 기록용 AI 판단". 실제 매매 결정은 사용자가 합니다.

import {
  TradePlan,
  AddBuyCheck,
  AddBuyConditions,
  ActionRecommend,
  ADD_BUY_LABEL,
  nowISO,
  calculateAvgBuyPrice,
} from './trade_plan';
import { BeginnerRow } from './beginner';

// ───────────────────────────────────────────────────────────────
// 예약매수 대기 — AI 판단 3 단계 (사용자 명세 §6)
// ───────────────────────────────────────────────────────────────
export type ReservationVerdict = 'KEEP' | 'CANCEL' | 'REVIEW';

export interface ReservationOpinion {
  verdict: ReservationVerdict;
  verdict_label: string;
  reason: string;
  today_actions: string[];
  diff1_pct: number;                       // 현재가 vs 1차 예약가
  diff2_pct: number | null;                // 현재가 vs 2차 예약가
}

export function buildReservationOpinion(
  plan: TradePlan,
  currentPrice: number,
): ReservationOpinion {
  const diff1 = (currentPrice - plan.first_buy_price) / plan.first_buy_price * 100;
  const diff2 = plan.second_buy_price
    ? (currentPrice - plan.second_buy_price) / plan.second_buy_price * 100
    : null;

  // (1) 손절가 이미 이탈 — 우선 체크
  if (currentPrice <= plan.stop_loss_price) {
    return {
      verdict: 'CANCEL',
      verdict_label: '예약 취소',
      reason: `현재가 ${currentPrice.toLocaleString()}원이 손절 기준가(${plan.stop_loss_price.toLocaleString()}원) 이미 이탈. U턴 실패 가능성.`,
      today_actions: [
        '키움에서 예약 즉시 취소',
        '카드에서 [취소] 클릭 + 취소 사유 기록',
        '추가 진입 보류',
      ],
      diff1_pct: diff1,
      diff2_pct: diff2,
    };
  }

  // (2) 현재가가 1차 예약가 +5% 이상 멀어짐
  if (diff1 > 5) {
    return {
      verdict: 'REVIEW',
      verdict_label: '가격 재검토',
      reason: `현재가가 1차 예약가 대비 +${diff1.toFixed(1)}% 이미 상승. 예약가 재산정 고려.`,
      today_actions: [
        '예약가 상향 또는 진입 포기 검토',
        '뒤늦은 추격 금지',
        '2차 예약가 근처 눌림 확인 후 재진입 판단',
      ],
      diff1_pct: diff1,
      diff2_pct: diff2,
    };
  }

  // (3) 그 외 — 예약 유지
  return {
    verdict: 'KEEP',
    verdict_label: '예약 유지',
    reason: `현재가 ${currentPrice.toLocaleString()}원 — 예약가 근처. U턴 신호 유지 중.`,
    today_actions: [
      '키움에서 예약 유지 확인',
      '시초가/장중 변동성 큰 경우만 재검토',
      '체결되면 카드에서 [1차 체결] 또는 [2차 체결] 클릭',
    ],
    diff1_pct: diff1,
    diff2_pct: diff2,
  };
}

// ───────────────────────────────────────────────────────────────
// 보유 의견 (사용자 명세 §7) — AI 판단 4 단계
// ───────────────────────────────────────────────────────────────
export interface HoldingOpinion {
  evaluated_at: string;
  current_price: number;
  pnl_pct: number;
  verdict: ActionRecommend;                // HOLD / PARTIAL_SELL / SELL / BUY_MORE_WAIT
  verdict_label: string;
  reason: string;
  today_actions: string[];
}

export function buildHoldingOpinion(
  plan: TradePlan,
  currentPrice: number,
  addBuyCheck?: AddBuyCheck | null,
): HoldingOpinion {
  const avgBuy = calculateAvgBuyPrice(plan);
  const pnl_pct = (currentPrice - avgBuy) / avgBuy * 100;
  const ts = nowISO();

  // (1) 목표 매도가 도달 → 일부매도
  if (currentPrice >= plan.target_sell_price) {
    return {
      evaluated_at: ts,
      current_price: currentPrice,
      pnl_pct,
      verdict: 'PARTIAL_SELL',
      verdict_label: '일부매도',
      reason: `목표 매도가(${plan.target_sell_price.toLocaleString()}원)에 도달. 일부 차익 실현 검토.`,
      today_actions: [
        '일부 차익실현 검토',
        '남은 수량 추세 확인',
        '추가 진입 금지',
      ],
    };
  }

  // (2) 손절 기준가 이탈 → 매도
  if (currentPrice <= plan.stop_loss_price) {
    return {
      evaluated_at: ts,
      current_price: currentPrice,
      pnl_pct,
      verdict: 'SELL',
      verdict_label: '매도',
      reason: `손절 기준가(${plan.stop_loss_price.toLocaleString()}원) 이탈. 매도 검토 우선 — 손실 확대 방지.`,
      today_actions: [
        '보유 이유 재점검',
        '손실 확대 방지',
        '추가매수 절대 금지',
      ],
    };
  }

  // (3) 추가매수 4 조건 모두 충족 → 추가매수 대기
  if (addBuyCheck && addBuyCheck.passed_count >= 4) {
    return {
      evaluated_at: ts,
      current_price: currentPrice,
      pnl_pct,
      verdict: 'BUY_MORE_WAIT',
      verdict_label: '추가매수 대기',
      reason: `추가매수 4 조건 모두 충족. 2차 매수가 근처 눌림에서 진입 검토 가능.`,
      today_actions: [
        '지금 추격매수하지 않음',
        '2차 매수가 근처 눌림 확인',
        '지지선 이탈 시 추가매수 금지',
      ],
    };
  }

  // (4) 그 외 → 보유
  const sign = pnl_pct >= 0 ? '+' : '';
  return {
    evaluated_at: ts,
    current_price: currentPrice,
    pnl_pct,
    verdict: 'HOLD',
    verdict_label: '보유',
    reason: `평균매수가 대비 ${sign}${pnl_pct.toFixed(1)}% — 목표가/손절가 모두 미도달. 보유 관찰 가능.`,
    today_actions: [
      '추가매수하지 않음 (체크가 4/4 가 아니면)',
      '목표 매도가 유지',
      '거래량 감소 여부 확인',
    ],
  };
}

// ───────────────────────────────────────────────────────────────
// 추가매수 4 조건 평가 (사용자 명세 §9)
// ───────────────────────────────────────────────────────────────
export function evaluateAddBuy(
  plan: TradePlan,
  currentPrice: number,
  row: BeginnerRow | null,
  withinBudgetByUser: boolean,
): AddBuyCheck {
  const ma60 = row?.ma60 ?? null;
  const value_ratio = row?.value_ratio ?? null;        // 거래대금 회복 배수

  // ① 1차 매수가 위 유지
  const above_first_buy = currentPrice >= plan.first_buy_price;

  // ② 거래량 급감 없이 눌림 — value_ratio ≥ 0.7 (사이드카에서 1.0 = 평균)
  const volume_holding = value_ratio != null ? value_ratio >= 0.7 : false;

  // ③ 60일선 또는 지지선 이탈 없음 — 현재가 ≥ ma60 * 0.97
  const support_holding = ma60 != null ? currentPrice >= ma60 * 0.97 : false;

  // ④ 총 투자금 한도 초과 없음 — 사용자 직접 체크
  const within_budget = withinBudgetByUser;

  const conditions: AddBuyConditions = {
    above_first_buy,
    volume_holding,
    support_holding,
    within_budget,
  };
  const passed_count = (Object.values(conditions) as boolean[]).filter(Boolean).length;

  let verdict: AddBuyCheck['verdict'];
  let verdict_label: string;
  let reason: string;
  const today_actions: string[] = [
    '지금 추격매수하지 않음',
    '2차 매수가 근처 눌림 확인',
    '지지선 이탈 시 추가매수 금지',
  ];

  if (passed_count >= 4) {
    verdict = 'BUY_MORE_OK';
    verdict_label = '추가매수 검토 가능';
    reason = '4 조건 모두 충족. 2차 매수가 근처 눌림 시 진입 검토 가능.';
  } else if (passed_count >= 2) {
    verdict = 'BUY_MORE_WAIT';
    verdict_label = '추가매수 대기';
    reason = `${passed_count}/4 조건 충족. 추가매수는 보류 — 2차 매수가 근처 눌림 확인 필요.`;
  } else {
    verdict = 'BUY_MORE_NO';
    verdict_label = '추가매수 금지';
    reason = `${passed_count}/4 조건만 충족. 추가매수 금지. 추세 회복 확인 후 재검토.`;
  }

  // 미충족 조건 안내 추가
  const missing: string[] = [];
  (Object.entries(conditions) as Array<[keyof AddBuyConditions, boolean]>).forEach(([k, v]) => {
    if (!v) missing.push(ADD_BUY_LABEL[k]);
  });
  if (missing.length > 0) {
    today_actions.push(`미충족: ${missing.join(' · ')}`);
  }

  return {
    evaluated_at: nowISO(),
    conditions,
    passed_count,
    verdict,
    verdict_label,
    reason,
    today_actions,
  };
}

// ───────────────────────────────────────────────────────────────
// 매매 계획 기본값 자동 제안
// ───────────────────────────────────────────────────────────────
export interface BuyPlanDefaults {
  first_buy_price: number;
  first_buy_reason: string;
  second_buy_price: number | null;
  second_buy_reason: string;
  target_sell_price: number;
  target_sell_reason: string;
  stop_loss_price: number;
  stop_loss_reason: string;
}

export function suggestBuyPlanDefaults(row: BeginnerRow | null): BuyPlanDefaults {
  const current = row?.close ?? null;
  const ma60 = row?.ma60 ?? null;

  if (current == null || current <= 0) {
    // 현재가 없으면 사용자 직접 입력
    return {
      first_buy_price: 0,
      first_buy_reason: '현재가를 자동으로 확인할 수 없어 사용자가 직접 입력해야 합니다.',
      second_buy_price: null,
      second_buy_reason: '60일선 근처에서 추가 매수 검토 가능 — 가격 직접 입력.',
      target_sell_price: 0,
      target_sell_reason: '60일선 +20% 또는 직전 고점 부근 — 가격 직접 입력.',
      stop_loss_price: 0,
      stop_loss_reason: '60일선 -5% 또는 본인 손절 원칙 — 가격 직접 입력.',
    };
  }

  return {
    first_buy_price: Math.round(current),
    first_buy_reason: '현재가 — U턴 신호가 확인되어 1차 관찰 매수 구간으로 설정.',

    second_buy_price: ma60 ? Math.round(ma60 * 1.02) : Math.round(current * 0.95),
    second_buy_reason: ma60
      ? '60일선 위 +2% 근처. 눌림목 발생 시 추가 확인 — 지지선 이탈 시 추가매수보다 손절 우선.'
      : '현재가 -5% 근처 눌림목 — 60일선 정보 없어 보수적 설정.',

    target_sell_price: ma60 ? Math.round(ma60 * 1.20) : Math.round(current * 1.10),
    target_sell_reason: ma60
      ? '60일선 +20% (이격 한계 직전). 일부매도 검토 — 최근 반등 고점 또는 전고점 근처.'
      : '현재가 +10% — 60일선 정보 없어 보수적 설정.',

    stop_loss_price: ma60 ? Math.round(ma60 * 0.95) : Math.round(current * 0.90),
    stop_loss_reason: ma60
      ? '60일선 -5% 이탈 시 U턴 실패 가능성. 손실 확대 방지 우선.'
      : '현재가 -10% — 60일선 정보 없어 보수적 설정.',
  };
}

// ───────────────────────────────────────────────────────────────
// 목표가/손절가 근접도 (GPT 리포트 §4 용)
// ───────────────────────────────────────────────────────────────
export interface ProximityInfo {
  to_target_pct: number;          // 음수: 아직 못 미침, 0/양수: 도달
  to_stop_loss_pct: number;       // 음수: 아직 안 닿음, 0/양수: 이탈
  near_target: boolean;           // 도달 -3% 이내
  near_stop_loss: boolean;        // 이탈 +3% 이내
}

export function evaluateProximity(plan: TradePlan, currentPrice: number): ProximityInfo {
  const to_target_pct = (currentPrice - plan.target_sell_price) / plan.target_sell_price * 100;
  const to_stop_loss_pct = (plan.stop_loss_price - currentPrice) / plan.stop_loss_price * 100;
  return {
    to_target_pct,
    to_stop_loss_pct,
    near_target: to_target_pct >= -3,
    near_stop_loss: to_stop_loss_pct >= -3,
  };
}
