// app/_lib/trade_storage.ts
// v0.4 매매 계획 localStorage CRUD
// - 키: tradePlans
// - 모든 함수는 SSR 환경에서도 안전 (typeof window 가드)
// - Supabase write 0건

import {
  TradePlan,
  TradeStatus,
  ActionRecommend,
  AddBuyCheck,
  TargetChangeEntry,
  StopLossChangeEntry,
  nowISO,
  newId,
} from './trade_plan';

const STORAGE_KEY = 'tradePlans';

// ───────────────────────────────────────────────────────────────
// Low-level: read / write
// ───────────────────────────────────────────────────────────────
function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadAllPlans(): TradePlan[] {
  const ls = safeLocalStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 유효성 최소 검증 — id/ticker 있는 것만
    return parsed.filter((p): p is TradePlan => {
      return p && typeof p === 'object' && typeof p.id === 'string' && typeof p.ticker === 'string';
    });
  } catch {
    return [];
  }
}

function saveAllPlans(plans: TradePlan[]): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(plans));
  } catch {
    // quota exceeded 등 — silently ignore
  }
}

// ───────────────────────────────────────────────────────────────
// CRUD
// ───────────────────────────────────────────────────────────────
export function findPlanById(id: string): TradePlan | null {
  return loadAllPlans().find(p => p.id === id) ?? null;
}

export function findPlansByTicker(ticker: string): TradePlan[] {
  return loadAllPlans().filter(p => p.ticker === ticker);
}

/** 동일 ticker + 종료(CLOSED/CANCELLED) 아님 = 활성 계획 */
export function findActivePlanByTicker(ticker: string): TradePlan | null {
  return loadAllPlans().find(p =>
    p.ticker === ticker && p.status !== 'CLOSED' && p.status !== 'CANCELLED'
  ) ?? null;
}

export function createPlan(plan: Omit<TradePlan, 'id' | 'created_at' | 'updated_at'>): TradePlan {
  const newPlan: TradePlan = {
    ...plan,
    id: newId(),
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  const plans = loadAllPlans();
  plans.push(newPlan);
  saveAllPlans(plans);
  return newPlan;
}

export function updatePlan(id: string, patch: Partial<TradePlan>): TradePlan | null {
  const plans = loadAllPlans();
  const idx = plans.findIndex(p => p.id === id);
  if (idx < 0) return null;
  const updated: TradePlan = {
    ...plans[idx],
    ...patch,
    id: plans[idx].id,
    created_at: plans[idx].created_at,
    updated_at: nowISO(),
  };
  plans[idx] = updated;
  saveAllPlans(plans);
  return updated;
}

export function deletePlan(id: string): boolean {
  const plans = loadAllPlans();
  const next = plans.filter(p => p.id !== id);
  if (next.length === plans.length) return false;
  saveAllPlans(next);
  return true;
}

// ───────────────────────────────────────────────────────────────
// 상태 변경 헬퍼
// ───────────────────────────────────────────────────────────────
export function changeStatus(
  id: string,
  status: TradeStatus,
  extras?: {
    actual_first_filled_price?: number;
    actual_second_filled_price?: number;
    cancellation_reason?: string;
    // v0.7 매도완료 결과
    closed_at_price?: number;
    closed_pnl_pct?: number;
    closed_at_date?: string;
    close_memo?: string;
  },
): TradePlan | null {
  const plans = loadAllPlans();
  const idx = plans.findIndex(p => p.id === id);
  if (idx < 0) return null;
  const cur = plans[idx];
  const ts = nowISO();

  const patch: Partial<TradePlan> = { status, updated_at: ts };
  if (status === 'RESERVED' && !cur.reserved_at) patch.reserved_at = ts;
  if (status === 'FIRST_FILLED') {
    if (!cur.first_filled_at) patch.first_filled_at = ts;
    if (extras?.actual_first_filled_price != null) patch.actual_first_filled_price = extras.actual_first_filled_price;
  }
  if (status === 'SECOND_FILLED') {
    if (!cur.second_filled_at) patch.second_filled_at = ts;
    if (extras?.actual_second_filled_price != null) patch.actual_second_filled_price = extras.actual_second_filled_price;
    // 2차 체결 후 자동 HOLDING 상태로도 인식되어야 함 — status 는 SECOND_FILLED 유지 (이력 보존)
  }
  if (status === 'HOLDING') {
    // 1차/2차 체결 → HOLDING 전이
    if (!cur.first_filled_at) patch.first_filled_at = ts;
  }
  if (status === 'CLOSED') {
    patch.closed_at = ts;
    // v0.7 매도완료 결과 필드 채움
    if (extras?.closed_at_price != null) patch.closed_at_price = extras.closed_at_price;
    if (extras?.closed_pnl_pct != null) patch.closed_pnl_pct = extras.closed_pnl_pct;
    if (extras?.closed_at_date) patch.closed_at_date = extras.closed_at_date;
    if (extras?.close_memo) patch.close_memo = extras.close_memo;
  }
  if (status === 'CANCELLED') {
    patch.cancelled_at = ts;
    if (extras?.cancellation_reason) patch.cancellation_reason = extras.cancellation_reason;
  }

  plans[idx] = { ...cur, ...patch };
  saveAllPlans(plans);
  return plans[idx];
}

// ───────────────────────────────────────────────────────────────
// 목표가 / 손절가 변경 (사용자 명세 §8 — 변경 이유 필수)
// ───────────────────────────────────────────────────────────────
export function changeTargetPrice(id: string, newPrice: number, reason: string): TradePlan | null {
  if (!reason || reason.trim().length === 0) {
    throw new Error('변경 이유는 필수입니다');
  }
  const plans = loadAllPlans();
  const idx = plans.findIndex(p => p.id === id);
  if (idx < 0) return null;
  const cur = plans[idx];
  const entry: TargetChangeEntry = {
    old_price: cur.target_sell_price,
    new_price: newPrice,
    reason: reason.trim(),
    changed_at: nowISO(),
  };
  plans[idx] = {
    ...cur,
    target_sell_price: newPrice,
    target_change_history: [...cur.target_change_history, entry],
    updated_at: nowISO(),
  };
  saveAllPlans(plans);
  return plans[idx];
}

export function changeStopLoss(id: string, newPrice: number, reason: string): TradePlan | null {
  if (!reason || reason.trim().length === 0) {
    throw new Error('변경 이유는 필수입니다');
  }
  const plans = loadAllPlans();
  const idx = plans.findIndex(p => p.id === id);
  if (idx < 0) return null;
  const cur = plans[idx];
  const entry: StopLossChangeEntry = {
    old_price: cur.stop_loss_price,
    new_price: newPrice,
    reason: reason.trim(),
    changed_at: nowISO(),
  };
  plans[idx] = {
    ...cur,
    stop_loss_price: newPrice,
    stop_loss_change_history: [...cur.stop_loss_change_history, entry],
    updated_at: nowISO(),
  };
  saveAllPlans(plans);
  return plans[idx];
}

// ───────────────────────────────────────────────────────────────
// 추가매수 체크 결과 저장
// ───────────────────────────────────────────────────────────────
export function saveAddBuyCheck(id: string, check: AddBuyCheck): TradePlan | null {
  return updatePlan(id, { add_buy_check: check });
}

// ───────────────────────────────────────────────────────────────
// AI 판단 변경
// ───────────────────────────────────────────────────────────────
export function changeAiJudgement(id: string, judgement: ActionRecommend): TradePlan | null {
  return updatePlan(id, { ai_judgement: judgement });
}

// ───────────────────────────────────────────────────────────────
// 그룹핑 (UI 섹션용)
// ───────────────────────────────────────────────────────────────
export interface PlanGroups {
  reserved: TradePlan[];    // WATCHING + RESERVED
  holding: TradePlan[];     // FIRST_FILLED + SECOND_FILLED + HOLDING + PARTIAL_SOLD
  closed: TradePlan[];      // CLOSED + CANCELLED
}

export function groupPlans(plans: TradePlan[]): PlanGroups {
  const reserved: TradePlan[] = [];
  const holding: TradePlan[] = [];
  const closed: TradePlan[] = [];
  for (const p of plans) {
    if (p.status === 'WATCHING' || p.status === 'RESERVED') reserved.push(p);
    else if (p.status === 'CLOSED' || p.status === 'CANCELLED') closed.push(p);
    else holding.push(p);
  }
  // 최근 수정 순
  const byUpdated = (a: TradePlan, b: TradePlan) => b.updated_at.localeCompare(a.updated_at);
  reserved.sort(byUpdated);
  holding.sort(byUpdated);
  closed.sort(byUpdated);
  return { reserved, holding, closed };
}
