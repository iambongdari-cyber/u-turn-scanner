// app/_lib/gpt_report.ts
// v0.4-2 GPT 상담용 리포트 — 행동 중심 (사용자 명세 §8)
//
// 변경:
//  - "신규 후보 138건" 같은 큰 숫자 제거
//  - 행동 중심 구성:
//    1. 오늘 할 일
//    2. 오늘 매매계획 기록 대상
//    3. 보유종목 점검
//    4. 예약매수 대기
//    5. 오늘 하지 말아야 할 행동
//    6. 참고 후보 요약 (맨 아래, 작게)

import {
  TradePlan,
  ActionRecommend,
  STATUS_LABEL,
  calculateAvgBuyPrice,
  isHoldingStatus,
  isReservedStatus,
  AI_DISCLAIMER,
} from './trade_plan';
import { BeginnerRow, judgeRow } from './beginner';
import { buildReservationOpinion, buildHoldingOpinion, evaluateProximity } from './scoring';
import {
  TodayBrief,
  TodayBriefItem,
  computeUrgency,
  selectTradePlanTargets,
  buildTodayBrief,
} from './today_brief';

export interface GptReportInput {
  base_date: string | null;
  rows: BeginnerRow[];
  plans: TradePlan[];
  currentPriceByTicker: Map<string, number>;
  previousJudgementByTicker?: Map<string, ActionRecommend>;
  brief: TodayBrief;
  briefItems: TodayBriefItem[];
  selectedNewTargets: TodayBriefItem[];
}

// ───────────────────────────────────────────────────────────────
// 메인 빌더 — v0.4-2 행동 중심 6 섹션
// ───────────────────────────────────────────────────────────────
export function buildGptReport(input: GptReportInput): string {
  const parts: string[] = [];
  parts.push(`# 오늘의 투자판단 리포트`);
  parts.push(`> 생성일: ${input.base_date ?? '-'} — ${AI_DISCLAIMER}`);
  parts.push('');

  parts.push(section1Todo(input.brief));
  parts.push(section2NewTargets(input.selectedNewTargets, input.currentPriceByTicker));
  parts.push(section3Holding(input.plans, input.currentPriceByTicker));
  parts.push(section4Reserved(input.plans, input.currentPriceByTicker));
  parts.push(section5DontDo(input.brief));
  parts.push(section6ReferenceSummary(input.briefItems));

  parts.push('');
  parts.push('---');
  parts.push(`※ ${AI_DISCLAIMER}`);
  parts.push('※ 키움 예약매수 / 실제 주문 / 자동매매 연동은 모두 없습니다.');
  return parts.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §1 오늘 할 일
// ───────────────────────────────────────────────────────────────
function section1Todo(brief: TodayBrief): string {
  const out: string[] = [];
  out.push(`## 1. 오늘 할 일`);
  if (brief.headlineTodoCount === 0) {
    out.push('오늘은 꼭 해야 할 매매 액션이 없습니다.');
    out.push('- [ ] 후보 전체 훑지 않기');
    out.push('- [ ] 손절가 없이 예약매수 넣지 않기');
    return out.join('\n');
  }
  const top1 = brief.todoActions.filter(a => a.priority === 'top1');
  const secondary = brief.todoActions.filter(a => a.priority === 'secondary');
  out.push('오늘 1순위 할 일은 이것입니다.');
  out.push('');
  if (top1.length > 0) {
    out.push('### 1순위');
    out.push(`1. ${top1[0].text}`);
  }
  if (secondary.length > 0) {
    out.push('');
    out.push('### 시간 있으면 추가 확인');
    for (let i = 0; i < secondary.length; i++) {
      out.push(`${i + 2}. ${secondary[i].text}`);
    }
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §2 오늘 매매계획 기록 대상 (1~3개)
// ───────────────────────────────────────────────────────────────
function section2NewTargets(targets: TodayBriefItem[], priceMap: Map<string, number>): string {
  const out: string[] = [];
  out.push(`\n## 2. 오늘 매매계획 기록 대상`);
  if (targets.length === 0) {
    out.push('- 오늘 신규 매매계획 기록 대상 없음.');
    out.push('- 참고 후보는 아래 요약 영역 참고.');
    return out.join('\n');
  }
  for (const it of targets) {
    if (!it.row) continue;
    const v = judgeRow(it.row);
    const cur = priceMap.get(it.ticker) ?? it.row.close ?? null;
    out.push(`- **${it.name} (${it.ticker})**`);
    out.push(`  - AI 판단: 매수 / 위험: ${labelRisk(v.risk)} / U턴: ${v.uturn_passed}/5`);
    if (cur != null) out.push(`  - 현재가: ${cur.toLocaleString()}원`);
    if (v.why_picked.length > 0) {
      out.push(`  - 사유: ${v.why_picked.slice(0, 3).join(' · ')}`);
    }
    out.push(`  - 행동: 매매 계획 기록 후 키움 예약매수 직접 입력`);
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §3 보유종목 점검
// ───────────────────────────────────────────────────────────────
function section3Holding(plans: TradePlan[], priceMap: Map<string, number>): string {
  const holding = plans.filter(p => isHoldingStatus(p.status));
  const out: string[] = [];
  out.push(`\n## 3. 보유종목 점검`);
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
// §4 예약매수 대기
// ───────────────────────────────────────────────────────────────
function section4Reserved(plans: TradePlan[], priceMap: Map<string, number>): string {
  const reserved = plans.filter(p => isReservedStatus(p.status));
  const out: string[] = [];
  out.push(`\n## 4. 예약매수 대기`);
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
// §5 오늘 하지 말아야 할 행동
// ───────────────────────────────────────────────────────────────
function section5DontDo(brief: TodayBrief): string {
  const out: string[] = [];
  out.push(`\n## 5. 오늘 하지 말아야 할 행동`);
  for (const d of brief.dontDo) {
    out.push(`- ${d}`);
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §6 참고 후보 요약 — 맨 아래, 작게 (사용자 명세 §8)
// ───────────────────────────────────────────────────────────────
function section6ReferenceSummary(items: TodayBriefItem[]): string {
  const out: string[] = [];
  out.push(`\n## 6. 참고 후보 요약`);
  const newOnly = items.filter(i => i.urgency.kind === 'NEW_CANDIDATE');
  const interest = newOnly.filter(i => i.urgency.level === 'INTEREST').length;
  const later = newOnly.filter(i => i.urgency.level === 'LATER').length;
  const hidden = newOnly.filter(i => i.urgency.level === 'HIDDEN').length;

  out.push(`참고 후보는 행동 대상이 아닙니다. 필요할 때만 화면에서 확인하세요.`);
  out.push('');
  out.push(`- 관심 후보 (흐름 변화 있음): ${interest}건`);
  out.push(`- 나중 후보 (조건 약함): ${later}건`);
  out.push(`- 숨김 (제외/위험): ${hidden}건`);

  // 관심 후보 중 상위 5개만 이름 노출
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
// 헬퍼: brief items 일괄 생성 + 매매계획 기록 대상 선정 + 결론
// 호출 측에서 한 줄로 모든 입력을 만들 수 있게 통합
// ───────────────────────────────────────────────────────────────
export interface BuildAllInput {
  rows: BeginnerRow[];
  plans: TradePlan[];
  priceMap: Map<string, number>;
  previousJudgementMap?: Map<string, ActionRecommend>;
}

export interface BuildAllResult {
  briefItems: TodayBriefItem[];
  brief: TodayBrief;
  selectedNewTargets: TodayBriefItem[];
}

export function buildAll(input: BuildAllInput): BuildAllResult {
  const briefItems = buildAllBriefItems(input);
  const newItems = briefItems.filter(i => i.urgency.kind === 'NEW_CANDIDATE');
  const reservedItems = briefItems.filter(i => i.urgency.kind === 'RESERVED');
  const holdingItems = briefItems.filter(i => i.urgency.kind === 'HOLDING');
  const hasHoldingOrReserved = reservedItems.length + holdingItems.length > 0;
  const selectedNewTargets = selectTradePlanTargets(newItems, hasHoldingOrReserved);
  const interestCount = newItems.filter(i => i.urgency.level === 'INTEREST').length;

  const brief = buildTodayBrief({
    selectedNewTargets,
    reservedItems,
    holdingItems,
    interestCount,
  });
  return { briefItems, brief, selectedNewTargets };
}

export function buildAllBriefItems(input: BuildAllInput): TodayBriefItem[] {
  const out: TodayBriefItem[] = [];
  const planTickers = new Set(input.plans.map(p => p.ticker));

  // 매매 계획 항목 (예약/보유)
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

  // 신규 후보 (매매 계획 미등록)
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
