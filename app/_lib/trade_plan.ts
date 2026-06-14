// app/_lib/trade_plan.ts
// v0.4 매매 계획 기록 (예약매수 계획) — 핵심 인터페이스 + 상태 enum + 헬퍼
//
// ※ 본 모듈은 "개인 기록용 AI 판단" 영역입니다.
// ※ 실제 키움 API 주문/자동매매/Supabase write 와는 아무 연관이 없습니다.
// ※ localStorage 저장 전용 (서버 저장 X).

// ───────────────────────────────────────────────────────────────
// AI 판단 라벨 — 사용자 명세 §2
// ───────────────────────────────────────────────────────────────
export type ActionRecommend =
  | 'WATCH'           // 관찰
  | 'BUY'             // 매수
  | 'HOLD'            // 보유
  | 'PARTIAL_SELL'    // 일부매도
  | 'SELL'            // 매도
  | 'EXCLUDE'         // 제외
  | 'BUY_MORE_WAIT';  // 추가매수 대기

export const ACTION_LABEL: Record<ActionRecommend, string> = {
  WATCH: '관찰',
  BUY: '매수',
  HOLD: '보유',
  PARTIAL_SELL: '일부매도',
  SELL: '매도',
  EXCLUDE: '제외',
  BUY_MORE_WAIT: '추가매수 대기',
};

export const ACTION_BADGE_CLASS: Record<ActionRecommend, string> = {
  WATCH: 'bg-sky-100 text-sky-800',
  BUY: 'bg-emerald-100 text-emerald-800',
  HOLD: 'bg-indigo-100 text-indigo-800',
  PARTIAL_SELL: 'bg-amber-100 text-amber-900',
  SELL: 'bg-orange-100 text-orange-900',
  EXCLUDE: 'bg-red-100 text-red-800',
  BUY_MORE_WAIT: 'bg-violet-100 text-violet-800',
};

// ───────────────────────────────────────────────────────────────
// 매매 상태 enum — 사용자 명세 §5 (8 단계)
// ───────────────────────────────────────────────────────────────
export type TradeStatus =
  | 'WATCHING'
  | 'RESERVED'
  | 'FIRST_FILLED'
  | 'SECOND_FILLED'
  | 'HOLDING'
  | 'PARTIAL_SOLD'
  | 'CLOSED'
  | 'CANCELLED';

export const STATUS_LABEL: Record<TradeStatus, string> = {
  WATCHING: '관찰중',
  RESERVED: '예약매수 대기',
  FIRST_FILLED: '1차 체결',
  SECOND_FILLED: '2차 체결',
  HOLDING: '보유중',
  PARTIAL_SOLD: '일부매도',
  CLOSED: '매도완료',
  CANCELLED: '취소',
};

export const STATUS_BADGE_CLASS: Record<TradeStatus, string> = {
  WATCHING: 'bg-sky-100 text-sky-800',
  RESERVED: 'bg-indigo-100 text-indigo-800',
  FIRST_FILLED: 'bg-emerald-100 text-emerald-800',
  SECOND_FILLED: 'bg-emerald-200 text-emerald-900',
  HOLDING: 'bg-emerald-100 text-emerald-800',
  PARTIAL_SOLD: 'bg-amber-100 text-amber-900',
  CLOSED: 'bg-slate-200 text-slate-700',
  CANCELLED: 'bg-red-100 text-red-800',
};

// ───────────────────────────────────────────────────────────────
// 부가 enum
// ───────────────────────────────────────────────────────────────
export type RiskLevel = 'LOW' | 'MED' | 'HIGH';

export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: '낮음',
  MED: '보통',
  HIGH: '높음',
};

export const RISK_BADGE_CLASS: Record<RiskLevel, string> = {
  LOW: 'bg-emerald-100 text-emerald-800',
  MED: 'bg-amber-100 text-amber-900',
  HIGH: 'bg-red-100 text-red-800',
};

export type BeginnerCategory =
  | 'BOTTOM_UTURN'    // 바닥 U턴 후보
  | 'CURRENT_LEADER'  // 현재 주도주
  | 'LATE_STRONG';    // 후발 강세 후보

export const CATEGORY_LABEL: Record<BeginnerCategory, string> = {
  BOTTOM_UTURN: '바닥 U턴 후보',
  CURRENT_LEADER: '현재 주도주',
  LATE_STRONG: '후발 강세 후보',
};

// U턴 단계 (사용자 명세 §3)
export type UTurnStageLevel = 'VERY_STRONG' | 'STRONG' | 'WATCH' | 'WEAK';

export const UTURN_STAGE_LABEL: Record<UTurnStageLevel, string> = {
  VERY_STRONG: '매우 강함',
  STRONG: '강함',
  WATCH: '관찰',
  WEAK: '약함',
};

export const UTURN_STAGE_BADGE_CLASS: Record<UTurnStageLevel, string> = {
  VERY_STRONG: 'bg-violet-200 text-violet-900',
  STRONG: 'bg-emerald-100 text-emerald-800',
  WATCH: 'bg-sky-100 text-sky-800',
  WEAK: 'bg-slate-200 text-slate-700',
};

// 5조건 체크 (사용자 명세 §3 체크리스트 예시)
export interface UTurnConditions {
  enough_drop_and_bottom: boolean;   // 충분한 하락 + 바닥 머무름
  recover_above_ma60: boolean;       // 60일선 위로 회복
  volume_recovery: boolean;          // 거래량(거래대금 비율) 회복
  value_threshold: boolean;          // 거래대금 임계 충족
  ma60_trend_up: boolean;            // 60일선 추세 상향
}

export const UTURN_CONDITION_LABEL: Record<keyof UTurnConditions, string> = {
  enough_drop_and_bottom: '충분한 하락 + 바닥 머무름',
  recover_above_ma60: '60일선 위로 회복',
  volume_recovery: '거래량 회복',
  value_threshold: '거래대금 임계 충족',
  ma60_trend_up: '60일선 추세 상향',
};

export function countUTurnConditions(c: UTurnConditions | null | undefined): number {
  if (!c) return 0;
  return [
    c.enough_drop_and_bottom,
    c.recover_above_ma60,
    c.volume_recovery,
    c.value_threshold,
    c.ma60_trend_up,
  ].filter(Boolean).length;
}

export function deriveUTurnStageLevel(c: UTurnConditions | null | undefined): UTurnStageLevel {
  const n = countUTurnConditions(c);
  if (n >= 5) return 'VERY_STRONG';
  if (n === 4) return 'STRONG';
  if (n === 3) return 'WATCH';
  return 'WEAK';
}

// ───────────────────────────────────────────────────────────────
// 채점 스냅샷 — 3차 보완 10필드 그대로
// ───────────────────────────────────────────────────────────────
export interface ScoringSnapshot {
  name: string;
  ticker: string;
  bought_at: string;                            // ISO YYYY-MM-DD
  buy_price: number;                            // 호환용 = first_buy_price
  category_at_time: BeginnerCategory;
  action_recommend_at_time: ActionRecommend;
  risk_at_time: RiskLevel;
  uturn_conditions_at_time: UTurnConditions | null;
  why_picked_at_time: string[];
  beginner_checklist_at_time: string[];
}

// ───────────────────────────────────────────────────────────────
// 변경 이력 (사용자 명세 §8)
// ───────────────────────────────────────────────────────────────
export interface TargetChangeEntry {
  old_price: number;
  new_price: number;
  reason: string;
  changed_at: string;
}

export interface StopLossChangeEntry {
  old_price: number;
  new_price: number;
  reason: string;
  changed_at: string;
}

// ───────────────────────────────────────────────────────────────
// 추가매수 체크 (사용자 명세 §9)
// ───────────────────────────────────────────────────────────────
export interface AddBuyConditions {
  above_first_buy: boolean;          // 1차 매수가 위 유지
  volume_holding: boolean;           // 거래량 급감 없이 눌림
  support_holding: boolean;          // 60일선 또는 지지선 이탈 없음
  within_budget: boolean;            // 총 투자금 한도 초과 없음 (사용자 수동)
}

export const ADD_BUY_LABEL: Record<keyof AddBuyConditions, string> = {
  above_first_buy: '1차 매수가 위 유지',
  volume_holding: '거래량 급감 없이 눌림',
  support_holding: '60일선 또는 지지선 이탈 없음',
  within_budget: '총 투자금 한도 초과 없음',
};

export interface AddBuyCheck {
  evaluated_at: string;
  conditions: AddBuyConditions;
  passed_count: number;              // 0~4
  verdict: 'BUY_MORE_OK' | 'BUY_MORE_WAIT' | 'BUY_MORE_NO';
  verdict_label: string;
  reason: string;
  today_actions: string[];
}

// ───────────────────────────────────────────────────────────────
// 매매 계획 본체 (사용자 명세 §4 + §5 + §8 + §9 통합)
// ───────────────────────────────────────────────────────────────
export interface TradePlan {
  // 식별
  id: string;                                  // uuid
  ticker: string;
  name: string;

  // 매매 계획 (§4)
  first_buy_price: number;
  first_buy_reason: string;
  second_buy_price: number | null;
  second_buy_reason: string | null;
  target_sell_price: number;
  target_sell_reason: string;
  stop_loss_price: number;
  stop_loss_reason: string;

  // AI 판단 + 추천 이유
  ai_judgement: ActionRecommend;
  buy_recommend_reason: string;

  // 상태 + 체결 이력 (§5)
  status: TradeStatus;
  reserved_at: string | null;
  first_filled_at: string | null;
  second_filled_at: string | null;
  actual_first_filled_price: number | null;
  actual_second_filled_price: number | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;

  // v0.7 매도완료 결과 (옵셔널 — 기존 plans 호환)
  closed_at_price: number | null;        // 실제 종료가
  closed_pnl_pct: number | null;         // 수익률 % (자동 계산 또는 사용자 수정)
  closed_at_date: string | null;         // 종료일 YYYY-MM-DD
  close_memo: string | null;             // 메모

  // 채점 스냅샷
  scoring_snapshot: ScoringSnapshot;

  // 변경 이력 (§8)
  target_change_history: TargetChangeEntry[];
  stop_loss_change_history: StopLossChangeEntry[];

  // 추가매수 검토 (§9) — 최근 평가 결과만 보관
  add_buy_check: AddBuyCheck | null;

  // 메모
  user_memo: string;

  // 타임스탬프
  created_at: string;
  updated_at: string;
}

// ───────────────────────────────────────────────────────────────
// 유틸
// ───────────────────────────────────────────────────────────────

/** uuid 대용 — crypto.randomUUID() 가 없는 환경 대비 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // fallback: timestamp + random
  return `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** 보유 상태로 간주되는 상태들 */
export function isHoldingStatus(s: TradeStatus): boolean {
  return s === 'FIRST_FILLED' || s === 'SECOND_FILLED' || s === 'HOLDING' || s === 'PARTIAL_SOLD';
}

/** 예약매수 대기 상태 */
export function isReservedStatus(s: TradeStatus): boolean {
  return s === 'WATCHING' || s === 'RESERVED';
}

/** 종료된 상태 */
export function isClosedStatus(s: TradeStatus): boolean {
  return s === 'CLOSED' || s === 'CANCELLED';
}

/** 평균 매수가 — 단순 평균 (수량 모름. v0.4.1+ 에서 수량 도입 예정) */
export function calculateAvgBuyPrice(plan: TradePlan): number {
  const p1 = plan.actual_first_filled_price ?? plan.first_buy_price;
  const p2 = plan.actual_second_filled_price ?? plan.second_buy_price;

  if (plan.status === 'FIRST_FILLED') return p1;
  if (plan.status === 'SECOND_FILLED' || plan.status === 'HOLDING' || plan.status === 'PARTIAL_SOLD') {
    return p2 ? Math.round((p1 + p2) / 2) : p1;
  }
  return p1;
}

/** 안내 문구 (모든 화면에서 동반 노출) */
export const AI_DISCLAIMER = '개인 기록용 AI 판단입니다. 실제 최종 결정은 내가 합니다.';
export const KIWOOM_DISCLAIMER = '키움 예약매수는 사용자가 직접 합니다.';
export const NOT_REAL_TRADE_DISCLAIMER = '이 기록은 실제 매매가 아닙니다.';
