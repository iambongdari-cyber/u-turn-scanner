// app/_lib/gpt_report.ts
// v0.4 GPT 상담용 리포트 — 8 섹션 마크다운 빌더 (사용자 명세 §11)
//
// 1. 신규 후보
// 2. 예약매수 대기 종목
// 3. 체결된 보유종목
// 4. 목표가/손절가 근접 종목
// 5. AI 판단 변경 종목
// 6. 오늘 내가 해야 할 행동
// 7. 목표가/손절가 변경 이력
// 8. 추가매수 검토 종목

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

export interface GptReportInput {
  base_date: string | null;                    // scan_dump.base_date
  rows: BeginnerRow[];                         // 오늘 후보 (분류 전)
  plans: TradePlan[];                          // 전체 매매 계획
  currentPriceByTicker: Map<string, number>;   // 사이드카에서 추출한 현재가 매핑
  previousJudgementByTicker?: Map<string, ActionRecommend>;  // 어제 AI 판단 (선택)
}

// ───────────────────────────────────────────────────────────────
// 메인 빌더
// ───────────────────────────────────────────────────────────────
export function buildGptReport(input: GptReportInput): string {
  const parts: string[] = [];
  parts.push(`# 오늘의 투자 상담 리포트`);
  parts.push(`> 생성일: ${input.base_date ?? '-'} — ${AI_DISCLAIMER}`);
  parts.push('');

  parts.push(section1NewCandidates(input.rows, input.plans));
  parts.push(section2Reserved(input.plans, input.currentPriceByTicker));
  parts.push(section3Holdings(input.plans, input.currentPriceByTicker));
  parts.push(section4Proximity(input.plans, input.currentPriceByTicker));
  parts.push(section5JudgementChanges(input.rows, input.previousJudgementByTicker));
  parts.push(section6TodayActions(input.plans, input.currentPriceByTicker));
  parts.push(section7ChangeHistory(input.plans));
  parts.push(section8AddBuy(input.plans, input.currentPriceByTicker));

  parts.push('');
  parts.push('---');
  parts.push(`※ ${AI_DISCLAIMER}`);
  parts.push('※ 키움 예약매수 / 실제 주문 / 자동매매 연동은 모두 없습니다.');
  return parts.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §1 신규 후보 — 오늘 사이드카에서 잡힌 종목 중 매매 계획 미기록 종목
// ───────────────────────────────────────────────────────────────
function section1NewCandidates(rows: BeginnerRow[], plans: TradePlan[]): string {
  const planTickers = new Set(plans.map(p => p.ticker));
  const news: BeginnerRow[] = rows.filter(r => !planTickers.has(r.ticker));
  // 상위 10개만
  const top = news.slice(0, 10);

  const out: string[] = [];
  out.push(`## 1. 신규 후보 (오늘 새로 등장)`);
  if (top.length === 0) {
    out.push('- 오늘 신규 후보 없음.');
    return out.join('\n');
  }
  for (const r of top) {
    const v = judgeRow(r);
    out.push(`- **${r.name} (${r.ticker})** — 카테고리 ${labelCategory(v.category)}, AI 판단: ${ACTION_LABEL[v.ai_judgement]}, 위험 ${labelRisk(v.risk)}, U턴 ${v.uturn_passed}/5`);
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §2 예약매수 대기 종목
// ───────────────────────────────────────────────────────────────
function section2Reserved(plans: TradePlan[], priceMap: Map<string, number>): string {
  const reserved = plans.filter(p => isReservedStatus(p.status));
  const out: string[] = [];
  out.push(`\n## 2. 예약매수 대기 종목`);
  if (reserved.length === 0) {
    out.push('- 현재 예약매수 대기 종목 없음.');
    return out.join('\n');
  }
  for (const p of reserved) {
    const cur = priceMap.get(p.ticker);
    out.push(`- **${p.name} (${p.ticker})** — 상태: ${STATUS_LABEL[p.status]}`);
    out.push(`  - 1차 예약가: ${p.first_buy_price.toLocaleString()}원` +
      (p.second_buy_price ? ` / 2차: ${p.second_buy_price.toLocaleString()}원` : ''));
    if (cur != null) {
      const op = buildReservationOpinion(p, cur);
      const sign1 = op.diff1_pct >= 0 ? '+' : '';
      out.push(`  - 현재가: ${cur.toLocaleString()}원 (1차 대비 ${sign1}${op.diff1_pct.toFixed(1)}%)`);
      out.push(`  - AI 판단: **${op.verdict_label}**`);
      out.push(`  - 이유: ${op.reason}`);
      out.push(`  - 오늘 행동:`);
      for (const a of op.today_actions) out.push(`    - [ ] ${a}`);
    } else {
      out.push(`  - 현재가 정보 없음 — 키움에서 직접 확인.`);
    }
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §3 체결된 보유종목
// ───────────────────────────────────────────────────────────────
function section3Holdings(plans: TradePlan[], priceMap: Map<string, number>): string {
  const holding = plans.filter(p => isHoldingStatus(p.status));
  const out: string[] = [];
  out.push(`\n## 3. 체결된 보유종목`);
  if (holding.length === 0) {
    out.push('- 현재 보유 종목 없음.');
    return out.join('\n');
  }
  for (const p of holding) {
    const cur = priceMap.get(p.ticker);
    const avg = calculateAvgBuyPrice(p);
    out.push(`- **${p.name} (${p.ticker})**`);
    out.push(`  - 체결 상태: ${STATUS_LABEL[p.status]}` +
      (p.first_filled_at ? ` (${p.first_filled_at.slice(0, 10)})` : ''));
    out.push(`  - 평균매수가: ${avg.toLocaleString()}원`);
    if (cur != null) {
      const op = buildHoldingOpinion(p, cur, p.add_buy_check);
      const sign = op.pnl_pct >= 0 ? '+' : '';
      out.push(`  - 현재가: ${cur.toLocaleString()}원 (수익률 ${sign}${op.pnl_pct.toFixed(1)}%)`);
      out.push(`  - 목표가: ${p.target_sell_price.toLocaleString()}원 / 손절가: ${p.stop_loss_price.toLocaleString()}원`);
      out.push(`  - AI 판단: **${op.verdict_label}**`);
      out.push(`  - 이유: ${op.reason}`);
      out.push(`  - 오늘 행동:`);
      for (const a of op.today_actions) out.push(`    - [ ] ${a}`);
    } else {
      out.push(`  - 현재가 정보 없음 — 키움에서 직접 확인.`);
    }
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §4 목표가/손절가 근접 종목
// ───────────────────────────────────────────────────────────────
function section4Proximity(plans: TradePlan[], priceMap: Map<string, number>): string {
  const out: string[] = [];
  out.push(`\n## 4. 목표가/손절가 근접 종목`);
  const items: string[] = [];
  for (const p of plans) {
    if (!isHoldingStatus(p.status) && !isReservedStatus(p.status)) continue;
    const cur = priceMap.get(p.ticker);
    if (cur == null) continue;
    const prox = evaluateProximity(p, cur);
    if (prox.near_target) {
      const dist = Math.abs(prox.to_target_pct).toFixed(1);
      const reached = prox.to_target_pct >= 0 ? '도달' : `남음 ${dist}%`;
      items.push(`- **${p.name} (${p.ticker})** — 현재가 ${cur.toLocaleString()}원 / 목표가 ${p.target_sell_price.toLocaleString()}원 (${reached})\n  → 일부매도 검토 임박`);
    }
    if (prox.near_stop_loss) {
      const dist = Math.abs(prox.to_stop_loss_pct).toFixed(1);
      const breached = prox.to_stop_loss_pct >= 0 ? '이탈' : `남음 ${dist}%`;
      items.push(`- **${p.name} (${p.ticker})** — 현재가 ${cur.toLocaleString()}원 / 손절가 ${p.stop_loss_price.toLocaleString()}원 (${breached})\n  → 매도 주의`);
    }
  }
  if (items.length === 0) {
    out.push('- 근접 종목 없음.');
  } else {
    out.push(...items);
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §5 AI 판단 변경 종목 (어제 → 오늘)
// ───────────────────────────────────────────────────────────────
function section5JudgementChanges(
  rows: BeginnerRow[],
  prev: Map<string, ActionRecommend> | undefined,
): string {
  const out: string[] = [];
  out.push(`\n## 5. AI 판단 변경 종목 (어제 → 오늘)`);
  if (!prev || prev.size === 0) {
    out.push('- 어제 데이터가 없어 비교 불가.');
    return out.join('\n');
  }
  const changes: string[] = [];
  for (const r of rows) {
    const today = judgeRow(r).ai_judgement;
    const yesterday = prev.get(r.ticker);
    if (yesterday && yesterday !== today) {
      changes.push(`- **${r.name} (${r.ticker})**: ${ACTION_LABEL[yesterday]} → **${ACTION_LABEL[today]}**`);
    }
  }
  if (changes.length === 0) {
    out.push('- 어제 대비 AI 판단 변경 없음.');
  } else {
    out.push(...changes.slice(0, 15));
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §6 오늘 내가 해야 할 행동 (체크리스트 통합)
// ───────────────────────────────────────────────────────────────
function section6TodayActions(plans: TradePlan[], priceMap: Map<string, number>): string {
  const out: string[] = [];
  out.push(`\n## 6. 오늘 내가 해야 할 행동`);
  const actions: string[] = [];

  for (const p of plans) {
    if (isReservedStatus(p.status)) {
      const cur = priceMap.get(p.ticker);
      if (cur != null) {
        const op = buildReservationOpinion(p, cur);
        actions.push(`- [ ] **${p.name}**: ${op.today_actions[0] ?? op.verdict_label}`);
      } else {
        actions.push(`- [ ] **${p.name}**: 키움 예약 상태 확인`);
      }
    } else if (isHoldingStatus(p.status)) {
      const cur = priceMap.get(p.ticker);
      if (cur != null) {
        const op = buildHoldingOpinion(p, cur, p.add_buy_check);
        actions.push(`- [ ] **${p.name}**: ${op.today_actions[0] ?? op.verdict_label}`);
      } else {
        actions.push(`- [ ] **${p.name}**: 현재가/수익률 확인`);
      }
    }
  }

  if (actions.length === 0) {
    out.push('- 오늘 특별히 해야 할 행동 없음. 신규 후보만 점검.');
  } else {
    out.push(...actions);
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §7 목표가/손절가 변경 이력 (최근 7일)
// ───────────────────────────────────────────────────────────────
function section7ChangeHistory(plans: TradePlan[]): string {
  const out: string[] = [];
  out.push(`\n## 7. 목표가/손절가 변경 이력 (최근 7일)`);
  const cutoffMs = Date.now() - 7 * 24 * 3600 * 1000;
  const items: string[] = [];
  for (const p of plans) {
    for (const e of p.target_change_history) {
      if (new Date(e.changed_at).getTime() >= cutoffMs) {
        items.push(`- **${p.name}** 목표가: ${e.old_price.toLocaleString()} → ${e.new_price.toLocaleString()}원 (${e.changed_at.slice(0, 10)})\n  - 이유: ${e.reason}`);
      }
    }
    for (const e of p.stop_loss_change_history) {
      if (new Date(e.changed_at).getTime() >= cutoffMs) {
        items.push(`- **${p.name}** 손절가: ${e.old_price.toLocaleString()} → ${e.new_price.toLocaleString()}원 (${e.changed_at.slice(0, 10)})\n  - 이유: ${e.reason}`);
      }
    }
  }
  if (items.length === 0) {
    out.push('- 최근 7일 내 변경 이력 없음.');
  } else {
    out.push(...items);
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §8 추가매수 검토 종목
// ───────────────────────────────────────────────────────────────
function section8AddBuy(plans: TradePlan[], priceMap: Map<string, number>): string {
  const out: string[] = [];
  out.push(`\n## 8. 추가매수 검토 종목`);
  const items: string[] = [];
  for (const p of plans) {
    if (!isHoldingStatus(p.status)) continue;
    const c = p.add_buy_check;
    if (!c) continue;
    const cur = priceMap.get(p.ticker);
    const curStr = cur != null ? ` (현재가 ${cur.toLocaleString()}원)` : '';
    items.push(`- **${p.name} (${p.ticker})**${curStr}: ${c.passed_count}/4 조건 충족 → ${c.verdict_label}`);
    items.push(`  - 이유: ${c.reason}`);
  }
  if (items.length === 0) {
    out.push('- 추가매수 검토 종목 없음.');
  } else {
    out.push(...items);
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// 라벨 헬퍼
// ───────────────────────────────────────────────────────────────
function labelCategory(c: string): string {
  switch (c) {
    case 'BOTTOM_UTURN': return '바닥 U턴';
    case 'CURRENT_LEADER': return '주도주';
    case 'LATE_STRONG': return '후발 강세';
    default: return c;
  }
}

function labelRisk(r: string): string {
  switch (r) {
    case 'LOW': return '낮음';
    case 'MED': return '보통';
    case 'HIGH': return '높음';
    default: return r;
  }
}
