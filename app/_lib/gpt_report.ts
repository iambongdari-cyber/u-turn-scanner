// app/_lib/gpt_report.ts
// v0.6 GPT 상담용 리포트 — 투자 코치 1단계 (사용자 명세 §0~§8)
//
// 섹션 순서:
//   0. 오늘의 결론 (자연어 코치)
//   1. 시장 상태
//   2. 전략 컨디션 (v0.6 = 데이터 부족)
//   3. 오늘 해야 할 행동
//   4. 오늘 하지 말아야 할 행동
//   5. 매매계획 기록 대상
//   6. 보유종목 점검
//   7. 예약매수 대기
//   8. 참고 후보 요약

import {
  TradePlan,
  ActionRecommend,
  STATUS_LABEL,
  ACTION_LABEL,
  calculateAvgBuyPrice,
  isHoldingStatus,
  isReservedStatus,
  AI_DISCLAIMER,
} from './trade_plan';
import { BeginnerRow, judgeRow } from './beginner';
import { buildReservationOpinion, buildHoldingOpinion, evaluateProximity } from './scoring';
import {
  TodayBriefItem,
  computeUrgency,
  selectTradePlanTargets,
} from './today_brief';
import {
  MarketRegimeResult,
  regimeReportLines,
  conclusionReportLines,
} from './market_regime';
import {
  StrategyConditionResult,
  strategyConditionReportLines,
  evaluateStrategyCondition,
} from './strategy_condition';

export interface GptReportInput {
  base_date: string | null;
  rows: BeginnerRow[];
  plans: TradePlan[];
  currentPriceByTicker: Map<string, number>;
  previousJudgementByTicker?: Map<string, ActionRecommend>;
  briefItems: TodayBriefItem[];
  selectedNewTargets: TodayBriefItem[];
  marketRegime?: MarketRegimeResult | null;
  strategyCondition?: StrategyConditionResult | null;
}

// ───────────────────────────────────────────────────────────────
// 메인 빌더 — v0.6 §0~§8
// ───────────────────────────────────────────────────────────────
export function buildGptReport(input: GptReportInput): string {
  const parts: string[] = [];
  parts.push(`# 오늘의 투자판단 리포트`);
  parts.push(`> 생성일: ${input.base_date ?? '-'} — ${AI_DISCLAIMER}`);
  parts.push('');

  parts.push(section0Conclusion(input.marketRegime ?? null));
  parts.push(section1Market(input.marketRegime ?? null));
  parts.push(section2StrategyCondition(input.strategyCondition ?? evaluateStrategyCondition(input.plans)));
  parts.push(section3DoToday(input.marketRegime ?? null));
  parts.push(section4DontDoToday(input.marketRegime ?? null));
  parts.push(section5TradeTargets(input.selectedNewTargets, input.currentPriceByTicker));
  parts.push(section6Holding(input.plans, input.currentPriceByTicker));
  parts.push(section7Reserved(input.plans, input.currentPriceByTicker));
  parts.push(section8Reference(input.briefItems));

  parts.push('');
  parts.push('---');
  parts.push(`※ ${AI_DISCLAIMER}`);
  parts.push('※ 키움 예약매수 / 실제 주문 / 자동매매 연동은 모두 없습니다.');
  parts.push('※ 실제 최종 결정은 사용자가 합니다. 리포트는 개인 기록용 AI 판단입니다.');
  return parts.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §0 오늘의 결론
// ───────────────────────────────────────────────────────────────
function section0Conclusion(regime: MarketRegimeResult | null): string {
  const out: string[] = [];
  out.push(`## 0. 오늘의 결론`);
  for (const line of conclusionReportLines(regime)) out.push(line);
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §1 시장 상태
// ───────────────────────────────────────────────────────────────
function section1Market(regime: MarketRegimeResult | null): string {
  const out: string[] = [];
  out.push(`\n## 1. 시장 상태`);
  for (const line of regimeReportLines(regime)) out.push(line);
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §2 전략 컨디션
// ───────────────────────────────────────────────────────────────
function section2StrategyCondition(condition: StrategyConditionResult): string {
  const out: string[] = [];
  out.push(`\n## 2. 전략 컨디션`);
  for (const line of strategyConditionReportLines(condition)) out.push(line);
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §3 오늘 해야 할 행동
// ───────────────────────────────────────────────────────────────
function section3DoToday(regime: MarketRegimeResult | null): string {
  const out: string[] = [];
  out.push(`\n## 3. 오늘 해야 할 행동`);
  const actions = regime?.recommendedActions ?? [
    '보합장 가정으로 보수적 접근',
    '1순위만 확인',
    '현금 비중 50% 이상 유지',
  ];
  for (const a of actions) out.push(`- ${a}`);
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §4 오늘 하지 말아야 할 행동
// ───────────────────────────────────────────────────────────────
function section4DontDoToday(regime: MarketRegimeResult | null): string {
  const out: string[] = [];
  out.push(`\n## 4. 오늘 하지 말아야 할 행동`);
  const actions = regime?.forbiddenActions ?? [
    '후보 전체 훑기',
    '손절가 없는 매수',
    '동시 다종목 진입',
  ];
  for (const a of actions) out.push(`- ${a}`);
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §5 매매계획 기록 대상
// ───────────────────────────────────────────────────────────────
function section5TradeTargets(targets: TodayBriefItem[], priceMap: Map<string, number>): string {
  const out: string[] = [];
  out.push(`\n## 5. 매매계획 기록 대상`);
  if (targets.length === 0) {
    out.push('- 오늘 신규 매매계획 기록 대상 없음.');
    return out.join('\n');
  }
  for (const it of targets) {
    if (!it.row) continue;
    const v = judgeRow(it.row);
    const cur = priceMap.get(it.ticker) ?? it.row.close ?? null;
    out.push(`- **${it.name} (${it.ticker})**`);
    out.push(`  - AI 판단: ${ACTION_LABEL[v.ai_judgement]} / 위험: ${labelRisk(v.risk)} / U턴: ${v.uturn_passed}/5`);
    if (cur != null) out.push(`  - 현재가: ${cur.toLocaleString()}원`);
    if (v.why_picked.length > 0) {
      out.push(`  - 사유:`);
      for (const w of v.why_picked.slice(0, 3)) out.push(`    · ${w}`);
    }
    out.push(`  - 행동:`);
    out.push(`    · 매매계획 기록`);
    out.push(`    · 손절가 입력`);
    out.push(`    · 예약매수 여부 직접 판단`);
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §6 보유종목 점검
// ───────────────────────────────────────────────────────────────
function section6Holding(plans: TradePlan[], priceMap: Map<string, number>): string {
  const holding = plans.filter(p => isHoldingStatus(p.status));
  const out: string[] = [];
  out.push(`\n## 6. 보유종목 점검`);
  if (holding.length === 0) {
    out.push('- 현재 보유 종목 없음.');
    return out.join('\n');
  }
  for (const p of holding) {
    const cur = priceMap.get(p.ticker);
    const avg = calculateAvgBuyPrice(p);
    out.push(`- **${p.name} (${p.ticker})** — ${STATUS_LABEL[p.status]}`);
    out.push(`  - 평균매수가 ${avg.toLocaleString()}원 / 목표가 ${p.target_sell_price.toLocaleString()}원 / 손절가 ${p.stop_loss_price.toLocaleString()}원`);
    if (cur != null) {
      const op = buildHoldingOpinion(p, cur, p.add_buy_check);
      const sign = op.pnl_pct >= 0 ? '+' : '';
      out.push(`  - 현재가 ${cur.toLocaleString()}원 (수익률 ${sign}${op.pnl_pct.toFixed(1)}%)`);
      out.push(`  - AI 판단: **${op.verdict_label}** — ${op.reason}`);
      const prox = evaluateProximity(p, cur);
      if (prox.near_target) out.push(`  - ⚠ 목표가 근접 (${Math.abs(prox.to_target_pct).toFixed(1)}% 남음)`);
      if (prox.near_stop_loss) out.push(`  - ⚠ 손절가 근접 (${Math.abs(prox.to_stop_loss_pct).toFixed(1)}% 남음)`);
      out.push(`  - 오늘 행동:`);
      for (const a of op.today_actions) out.push(`    - [ ] ${a}`);
    } else {
      out.push(`  - 현재가 정보 없음 — 키움에서 직접 확인.`);
    }
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §7 예약매수 대기
// ───────────────────────────────────────────────────────────────
function section7Reserved(plans: TradePlan[], priceMap: Map<string, number>): string {
  const reserved = plans.filter(p => isReservedStatus(p.status));
  const out: string[] = [];
  out.push(`\n## 7. 예약매수 대기`);
  if (reserved.length === 0) {
    out.push('- 현재 예약매수 대기 종목 없음.');
    return out.join('\n');
  }
  for (const p of reserved) {
    const cur = priceMap.get(p.ticker);
    out.push(`- **${p.name} (${p.ticker})** — ${STATUS_LABEL[p.status]}`);
    out.push(`  - 1차 ${p.first_buy_price.toLocaleString()}원${p.second_buy_price ? ` / 2차 ${p.second_buy_price.toLocaleString()}원` : ''}`);
    if (cur != null) {
      const op = buildReservationOpinion(p, cur);
      const sign = op.diff1_pct >= 0 ? '+' : '';
      out.push(`  - 현재가 ${cur.toLocaleString()}원 (1차 대비 ${sign}${op.diff1_pct.toFixed(1)}%)`);
      out.push(`  - AI 판단: **${op.verdict_label}** — ${op.reason}`);
      out.push(`  - 오늘 행동:`);
      for (const a of op.today_actions) out.push(`    - [ ] ${a}`);
    } else {
      out.push(`  - 현재가 정보 없음 — 키움에서 직접 확인.`);
    }
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §8 참고 후보 요약 (맨 아래, 작게)
// ───────────────────────────────────────────────────────────────
function section8Reference(items: TodayBriefItem[]): string {
  const out: string[] = [];
  out.push(`\n## 8. 참고 후보 요약`);
  const newOnly = items.filter(i => i.urgency.kind === 'NEW_CANDIDATE');
  const interest = newOnly.filter(i => i.urgency.level === 'INTEREST').length;
  const later = newOnly.filter(i => i.urgency.level === 'LATER').length;
  const hidden = newOnly.filter(i => i.urgency.level === 'HIDDEN').length;

  out.push(`참고 후보는 행동 대상이 아닙니다. 필요할 때만 화면에서 확인하세요.`);
  out.push('');
  out.push(`- 관심 후보 (흐름 변화 있음): ${interest}건`);
  out.push(`- 나중 후보 (조건 약함): ${later}건`);
  out.push(`- 숨김 (제외/위험): ${hidden}건`);

  const topInterest = newOnly
    .filter(i => i.urgency.level === 'INTEREST' && i.row)
    .slice(0, 5)
    .map(i => i.name);
  if (topInterest.length > 0) {
    out.push('');
    out.push(`관심 후보 예시: ${topInterest.join(' · ')}${interest > 5 ? ` 외 ${interest - 5}건` : ''}`);
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// 라벨
// ───────────────────────────────────────────────────────────────
function labelRisk(r: string): string {
  switch (r) {
    case 'LOW': return '낮음';
    case 'MED': return '보통';
    case 'HIGH': return '높음';
    default: return r;
  }
}

// ───────────────────────────────────────────────────────────────
// 헬퍼: brief items + 매매계획 기록 대상 일괄 생성
// ───────────────────────────────────────────────────────────────
export interface BuildAllInput {
  rows: BeginnerRow[];
  plans: TradePlan[];
  priceMap: Map<string, number>;
  previousJudgementMap?: Map<string, ActionRecommend>;
  regimeMode?: 'AGGRESSIVE' | 'SELECTIVE' | 'DEFENSIVE' | 'HOLD_CASH';
}

export interface BuildAllResult {
  briefItems: TodayBriefItem[];
  selectedNewTargets: TodayBriefItem[];
}

export function buildAll(input: BuildAllInput): BuildAllResult {
  const briefItems = buildAllBriefItems(input);
  const newItems = briefItems.filter(i => i.urgency.kind === 'NEW_CANDIDATE');
  const reservedItems = briefItems.filter(i => i.urgency.kind === 'RESERVED');
  const holdingItems = briefItems.filter(i => i.urgency.kind === 'HOLDING');
  const hasHoldingOrReserved = reservedItems.length + holdingItems.length > 0;
  const selectedNewTargets = selectTradePlanTargets(newItems, hasHoldingOrReserved, input.regimeMode);
  return { briefItems, selectedNewTargets };
}

export function buildAllBriefItems(input: BuildAllInput): TodayBriefItem[] {
  const out: TodayBriefItem[] = [];
  const planTickers = new Set(input.plans.map(p => p.ticker));

  for (const p of input.plans) {
    if (p.status === 'CLOSED' || p.status === 'CANCELLED') continue;
    const cur = input.priceMap.get(p.ticker) ?? null;
    const row = input.rows.find(r => r.ticker === p.ticker) ?? null;
    const urgency = computeUrgency({
      plan: p,
      row,
      currentPrice: cur,
      previousJudgement: input.previousJudgementMap?.get(p.ticker) ?? null,
    });
    out.push({
      ticker: p.ticker,
      name: p.name,
      urgency,
      plan: p,
      row,
      currentPrice: cur,
    });
  }

  for (const r of input.rows) {
    if (planTickers.has(r.ticker)) continue;
    const cur = input.priceMap.get(r.ticker) ?? null;
    const urgency = computeUrgency({
      plan: null,
      row: r,
      currentPrice: cur,
      previousJudgement: input.previousJudgementMap?.get(r.ticker) ?? null,
    });
    out.push({
      ticker: r.ticker,
      name: r.name,
      urgency,
      plan: null,
      row: r,
      currentPrice: cur,
    });
  }

  return out;
}
