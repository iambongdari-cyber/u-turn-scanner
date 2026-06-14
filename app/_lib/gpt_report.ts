// app/_lib/gpt_report.ts
// v0.6 GPT 상담용 리포트 — 투자 코치 1단계 (사용자 명세 §0~§8)
// v0.8-4 GPT에게 다시 물어보기 — 판단 리포트(buildJudgmentReport) 추가
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
//
// v0.8-4 추가:
//   buildJudgmentReport — v0.8 흐름(시장 흐름/업종/대장주/1순위 성격/내일 행동)
//   기반의 판단 리포트. 사용자는 buildJudgmentReport + buildGptReport(부록)
//   를 합친 결과를 ChatGPT 에 붙여넣어 한 번 더 검토받는다.

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
import { MarketStrength, CapStyle } from './market_strength';
import { SectorFlow } from './sector_flow';
import { StockCharacterResult } from './stock_character';
import { TomorrowAction } from './tomorrow_action';

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
  /** v0.7 전략 컨디션 상태 — 종목 선정 매트릭스에 반영 */
  conditionState?: 'DATA_INSUFFICIENT' | 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'CAUTION' | 'DANGER';
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
  const selectedNewTargets = selectTradePlanTargets(
    newItems,
    hasHoldingOrReserved,
    input.regimeMode,
    input.conditionState,
  );
  return { briefItems, selectedNewTargets };
}

// ═══════════════════════════════════════════════════════════════
// v0.8-4 GPT에게 다시 물어보기 — 판단 리포트
// ═══════════════════════════════════════════════════════════════
//
// 사용자 명세 §4:
//   리포트 구조:
//     # U턴스캐너 오늘의 판단 리포트
//     > 면책 1
//     > 면책 2
//     > 면책 3
//     ## 1. 오늘 장 요약
//     ## 2. 돈이 들어온 곳
//     ## 3. 오늘의 1순위 종목
//     ## 4. U턴스캐너 판단
//     ## 5. 내일 행동 지시
//     ## 6. ChatGPT에게 요청

export interface JudgmentReportInput {
  base_date: string | null;
  /** 시장 4단계 (BULL/NEUTRAL/BEAR/DANGER + UNKNOWN) + 점수 + 한국어 라벨 */
  marketRegime?: MarketRegimeResult | null;
  /** KOSPI/KOSDAQ 강도 + 상대강도 */
  marketStrength?: MarketStrength | null;
  /** 대형주/중소형주 흐름 */
  capStyle?: CapStyle | null;
  /** 업종 흐름 (TOP 3 + 주도 업종 + 대장주) */
  sectorFlow?: SectorFlow | null;
  /** 1순위 종목 5등급 성격 */
  stockCharacter?: StockCharacterResult | null;
  /** 내일 행동 지시 */
  tomorrowAction?: TomorrowAction | null;
  /** 전략 컨디션 (보유/예약 기반 실측) */
  strategyCondition?: StrategyConditionResult | null;
  /** 매매계획 기록 대상 1순위 (CoachShell 의 selectedNewTargets[0]) */
  topPick?: TodayBriefItem | null;
}

export function buildJudgmentReport(input: JudgmentReportInput): string {
  const parts: string[] = [];

  // ── 제목 + 면책
  parts.push('# U턴스캐너 오늘의 판단 리포트');
  parts.push(`> 생성일: ${input.base_date ?? '-'}`);
  parts.push('> 개인 기록용 AI 판단입니다.');
  parts.push('> 자동매매가 아니며 실제 주문은 사용자가 키움에서 직접 입력합니다.');
  parts.push('> 최종 판단은 사용자 본인 책임입니다.');
  parts.push('');

  parts.push(judgmentSection1Market(input.marketRegime ?? null, input.marketStrength ?? null, input.capStyle ?? null));
  parts.push(judgmentSection2SectorFlow(input.sectorFlow ?? null));
  parts.push(judgmentSection3TopPick(input.topPick ?? null, input.stockCharacter ?? null));
  parts.push(judgmentSection4Verdict(input.topPick ?? null, input.stockCharacter ?? null, input.marketRegime ?? null, input.sectorFlow ?? null, input.strategyCondition ?? null));
  parts.push(judgmentSection5TomorrowAction(input.tomorrowAction ?? null));
  parts.push(judgmentSection6AskChatGpt());

  return parts.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §1 오늘 장 요약
// ───────────────────────────────────────────────────────────────
function judgmentSection1Market(
  regime: MarketRegimeResult | null,
  strength: MarketStrength | null,
  capStyle: CapStyle | null,
): string {
  const out: string[] = [];
  out.push('## 1. 오늘 장 요약');
  if (!regime) {
    out.push('- 시장 판단 데이터가 부족합니다.');
    return out.join('\n');
  }
  const scoreSuffix = regime.displayScore != null ? ` ${regime.displayScore}점` : '';
  out.push(`- 오늘 시장은 **${regime.display}**${scoreSuffix} 입니다.`);
  if (regime.headline) out.push(`- ${regime.headline}`);

  if (!strength) {
    out.push('- KOSPI/KOSDAQ 세부 흐름 데이터가 부족합니다.');
  } else if (strength.insufficient) {
    out.push(`- ${strength.narrative}`);
  } else {
    out.push(`- KOSPI 강도: **${labelStrength(strength.kospi)}**`);
    out.push(`- KOSDAQ 강도: **${labelStrength(strength.kosdaq)}**`);
    out.push(`- 상대강도: ${labelRelative(strength.relative)}`);
    out.push(`- ${strength.narrative}`);
  }

  if (capStyle) {
    out.push(`- ${capStyle.narrative}`);
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §2 돈이 들어온 곳
// ───────────────────────────────────────────────────────────────
function judgmentSection2SectorFlow(sectorFlow: SectorFlow | null): string {
  const out: string[] = [];
  out.push('\n## 2. 돈이 들어온 곳');
  if (!sectorFlow) {
    out.push('- 업종 흐름 데이터가 부족합니다.');
    return out.join('\n');
  }
  if (sectorFlow.topThree.length === 0) {
    out.push(`- ${sectorFlow.narrative || '오늘 강한 업종을 특정하기 어렵습니다.'}`);
    if (sectorFlow.insufficient) {
      out.push('- 업종 매핑/데이터가 부족해 보수적으로 표시합니다.');
    }
    return out.join('\n');
  }

  const labels = sectorFlow.topThree.map(s => s.sectorLabel);
  out.push(`- 오늘 강한 업종 TOP 3: ${labels.join(', ')}`);

  const leading = sectorFlow.topThree.find(s => s.isLeading);
  if (leading) {
    out.push(`- 가장 뚜렷한 주도 업종: **${leading.sectorLabel}**`);
  } else {
    out.push('- 뚜렷한 단일 주도 업종은 없습니다.');
  }

  for (const s of sectorFlow.topThree) {
    const r20 = s.return20d != null ? `20일 ${s.return20d >= 0 ? '+' : ''}${s.return20d.toFixed(1)}%` : null;
    const score = `점수 ${s.score}`;
    const tags = [score, r20].filter(Boolean).join(' · ');
    out.push(`  - ${s.sectorLabel} (${tags})${s.isLeading ? ' ★ 주도' : ''}`);
  }

  // 대장주 후보
  const sectorKeys = Object.keys(sectorFlow.leadersBySector);
  if (sectorKeys.length === 0) {
    out.push('- 업종별 대장주를 특정하기 어려운 날입니다.');
  } else {
    out.push('- 대장주 후보:');
    for (const key of sectorKeys) {
      const arr = sectorFlow.leadersBySector[key];
      const names = arr.map(l => l.name).join(', ');
      const hasQuasi = arr.some(l => l.source === 'QUASI_LEADER');
      const sectorLabel = arr[0]?.sectorLabel ?? key;
      out.push(`  - ${sectorLabel}: ${names}${hasQuasi ? ' (준대장주 후보 포함)' : ''}`);
    }
  }

  if (sectorFlow.insufficient) {
    out.push('- ※ 업종 매핑/데이터가 부족해 일부 항목은 보수적으로 표시되었습니다.');
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §3 오늘의 1순위 종목
// ───────────────────────────────────────────────────────────────
function judgmentSection3TopPick(
  topPick: TodayBriefItem | null,
  character: StockCharacterResult | null,
): string {
  const out: string[] = [];
  out.push('\n## 3. 오늘의 1순위 종목');
  if (!topPick || !topPick.row) {
    out.push('- 오늘 1순위 종목이 없어 신규 진입보다 관망이 우선입니다.');
    if (character) {
      out.push(`- 성격 판단: **${character.label}** — ${character.narrative}`);
    }
    return out.join('\n');
  }

  out.push(`- 종목: **${topPick.name} (${topPick.ticker})**`);
  if (character) {
    out.push(`- 성격: **${character.label}**`);
    out.push(`- 위험도: ${labelCharRisk(character.riskLevel)}`);
    out.push(`- 행동 가능 여부: ${character.isActionable ? '내일 검토 가능' : '내일 신규 진입 대상에서 제외'}`);
    out.push(`- 판단 요약: ${character.narrative}`);
    if (character.reasoning.length > 0) {
      out.push(`- 근거: ${character.reasoning.join(' · ')}`);
    }
  } else {
    out.push('- 1순위 종목 성격 판단이 부족합니다.');
  }
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §4 U턴스캐너 판단
// ───────────────────────────────────────────────────────────────
function judgmentSection4Verdict(
  topPick: TodayBriefItem | null,
  character: StockCharacterResult | null,
  regime: MarketRegimeResult | null,
  sectorFlow: SectorFlow | null,
  condition: StrategyConditionResult | null,
): string {
  const out: string[] = [];
  out.push('\n## 4. U턴스캐너 판단');
  if (!topPick || !topPick.row) {
    out.push('- 오늘 1순위 종목이 없어 별도 판단을 제시하지 않습니다.');
    out.push('- 시장 흐름 / 업종 흐름이 회복될 때까지 관망 우선.');
    return out.join('\n');
  }
  const v = judgeRow(topPick.row);

  // 왜 볼 수 있는지
  out.push(`- **왜 이 종목을 볼 수 있는지**`);
  if (v.why_picked.length > 0) {
    for (const w of v.why_picked.slice(0, 4)) out.push(`  · ${w}`);
  } else {
    out.push(`  · U턴 ${v.uturn_passed}/5 통과 — 분류: ${labelCategoryKo(v.category)}`);
  }

  // 왜 조심해야 하는지
  out.push(`- **왜 조심해야 하는지**`);
  const cautionLines: string[] = [];
  if (character?.isActionable === false) {
    cautionLines.push(`성격이 ${character.label} 으로 분류 — 내일 신규 진입에서 제외 권장`);
  }
  const disparity = topPick.row.disparity_pct ?? null;
  if (disparity != null && disparity >= 10) {
    cautionLines.push(`이격 +${disparity.toFixed(1)}% — 단기 과열 가능성`);
  }
  if (v.risk === 'HIGH') cautionLines.push('내부 위험도 높음');
  if (cautionLines.length === 0) {
    cautionLines.push('손절가 없는 매수는 절대 금지');
    cautionLines.push('1순위라도 비중은 작게');
  }
  for (const c of cautionLines) out.push(`  · ${c}`);

  // 시장 흐름과 맞는가
  out.push(`- **시장 흐름과 맞는지**`);
  if (!regime) {
    out.push('  · 시장 판단 데이터 부족');
  } else if (regime.regime === 'DANGER') {
    out.push('  · 시장이 위험구간 — 신규 진입 자체가 보류 대상');
  } else if (regime.regime === 'BEAR') {
    out.push('  · 약세장 — 무리한 진입보다 보유 점검 우선');
  } else if (regime.regime === 'BULL') {
    if (character?.character === 'LEADING_FOLLOW') {
      out.push('  · 강세장 + 주도주 추종 — 시장 흐름과 일치');
    } else if (character?.character === 'LATE_ENTRY') {
      out.push('  · 강세장이지만 후발주 — 대장주 흐름이 유지될 때만 의미');
    } else if (character?.character === 'INDIVIDUAL_UTURN') {
      out.push('  · 강세장이지만 개별 U턴 — 시장 흐름과 완전 일치하지는 않음');
    } else {
      out.push('  · 강세장 흐름이나 종목 성격 점검 필요');
    }
  } else if (regime.regime === 'NEUTRAL') {
    out.push('  · 보합장 — 1순위만 작게');
  } else {
    out.push('  · 판단 데이터 부족 — 보수적으로 접근');
  }

  // 업종 흐름과 맞는가
  out.push(`- **업종 흐름과 맞는지**`);
  if (!sectorFlow) {
    out.push('  · 업종 흐름 데이터 부족');
  } else if (character?.character === 'LEADING_FOLLOW') {
    out.push('  · 주도(또는 강한) 업종 안의 대장주 — 업종 흐름과 일치');
  } else if (character?.character === 'LATE_ENTRY') {
    out.push('  · 강한 업종 안 후발주 — 대장주 흐름이 살아 있을 때만 따라간다');
  } else if (character?.character === 'INDIVIDUAL_UTURN') {
    out.push('  · 주도 업종 밖 개별 U턴 — 업종 흐름과는 분리해서 본다');
  } else if (character?.character === 'LATE_CHASE_RISK') {
    out.push('  · 끝물 추격 위험 — 업종 흐름과 무관하게 제외 권장');
  } else if (character?.character === 'WATCH_ONLY') {
    out.push('  · 관망 대상 — 업종 흐름 점검 우선');
  } else {
    out.push('  · 업종 흐름 판단 보류');
  }

  // 전략 컨디션과 맞는가
  out.push(`- **전략 컨디션과 맞는지**`);
  if (!condition) {
    out.push('  · 전략 컨디션 데이터 부족 (보유/예약 기록 없음)');
  } else if (condition.state === 'DANGER') {
    out.push('  · 전략 컨디션 위험 — 신규 진입 보류');
  } else if (condition.state === 'CAUTION') {
    out.push('  · 전략 컨디션 주의 — 비중은 작게');
  } else if (condition.state === 'DATA_INSUFFICIENT') {
    out.push('  · 전략 컨디션 데이터 부족 — 보수적으로 접근');
  } else {
    out.push(`  · 전략 컨디션 ${labelConditionState(condition.state)} — 신규 진입 가능 범위 안`);
  }

  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §5 내일 행동 지시
// ───────────────────────────────────────────────────────────────
function judgmentSection5TomorrowAction(action: TomorrowAction | null): string {
  const out: string[] = [];
  out.push('\n## 5. 내일 행동 지시');
  if (!action) {
    out.push('- 내일 행동 지시 데이터가 부족합니다.');
    out.push('- 손절가 없는 매수 금지 / 동시 다종목 매수 금지 원칙은 항상 유지하세요.');
    return out.join('\n');
  }

  out.push(`- 신규 진입 가능 여부: **${action.canEnterNew ? '가능' : '보류'}**`);
  out.push(`- 내일 볼 수 있는 종목 수: 최대 ${action.maxNewCount} 종목`);
  out.push(`- 매매 강도: ${labelIntensity(action.intensity)}`);
  if (action.topPickName) {
    out.push(`- 우선 종목: ${action.topPickName}`);
  }
  out.push(`- 예약매수 가능 여부: ${action.canEnterNew && action.maxNewCount >= 1 ? `최대 ${action.maxNewCount} 건` : '내일은 예약매수 보류'}`);

  out.push('- 내일 해야 할 행동:');
  for (const line of action.summaryLines) out.push(`  · ${line}`);

  out.push('- 금지 행동:');
  for (const line of action.mustNotDo) out.push(`  · ${line}`);

  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// §6 ChatGPT에게 요청 — 사용자 명세 §4 그대로
// ───────────────────────────────────────────────────────────────
function judgmentSection6AskChatGpt(): string {
  const out: string[] = [];
  out.push('\n## 6. ChatGPT에게 요청');
  out.push('');
  out.push('위 내용을 보고,');
  out.push('내가 직장인 초보 투자자라는 점을 고려해서');
  out.push('내일 실제로 어떻게 행동해야 하는지 한 번 더 점검해줘.');
  out.push('');
  out.push('특히 아래를 확인해줘.');
  out.push('1. U턴스캐너 판단이 시장 흐름과 맞는지');
  out.push('2. 1순위 종목을 내일 봐도 되는지');
  out.push('3. 무리한 매매라면 하지 말라고 말해줘');
  out.push('4. 손절가 없이 매수하려는 위험은 없는지');
  out.push('5. 직장인이라 장중 대응이 어렵다는 점을 고려해줘');
  return out.join('\n');
}

// ───────────────────────────────────────────────────────────────
// 라벨 헬퍼
// ───────────────────────────────────────────────────────────────
function labelStrength(s: MarketStrength['kospi']): string {
  switch (s) {
    case 'STRONG': return '강함';
    case 'NEUTRAL': return '보통';
    case 'WEAK': return '약함';
  }
}
function labelRelative(r: MarketStrength['relative']): string {
  switch (r) {
    case 'KOSPI_LEAD': return 'KOSPI 우위';
    case 'KOSDAQ_LEAD': return 'KOSDAQ 우위';
    case 'BALANCED': return '균형';
  }
}
function labelCharRisk(r: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  switch (r) {
    case 'LOW': return '낮음';
    case 'MEDIUM': return '보통';
    case 'HIGH': return '높음';
  }
}
function labelIntensity(i: TomorrowAction['intensity']): string {
  switch (i) {
    case 'NORMAL': return '정상';
    case 'LIGHT': return '약하게';
    case 'NONE': return '진입 보류';
  }
}
function labelConditionState(s: string): string {
  switch (s) {
    case 'EXCELLENT': return '매우 좋음';
    case 'GOOD': return '좋음';
    case 'AVERAGE': return '보통';
    case 'CAUTION': return '주의';
    case 'DANGER': return '위험';
    case 'DATA_INSUFFICIENT': return '데이터 부족';
    default: return s;
  }
}
function labelCategoryKo(c: string): string {
  switch (c) {
    case 'BOTTOM_UTURN': return '바닥 U턴';
    case 'CURRENT_LEADER': return '현재 주도주';
    case 'LATE_STRONG': return '후발 강세';
    default: return c;
  }
}

// ───────────────────────────────────────────────────────────────
// v0.8-4.2 ChatGPT 재점검용 고정 지시문 (리포트 최상단)
//   사용자가 리포트 전체를 ChatGPT 에 붙여넣기만 하면 바로 분석 요청이 되도록
//   답변 형식 7 항목을 미리 지시한다.
// ───────────────────────────────────────────────────────────────
export const CHATGPT_RECHECK_PROMPT = `# ChatGPT에게 요청

U턴스캐너 리포트 분석해줘.

나는 직장인 초보 투자자이고, 장중 대응이 어렵습니다.

아래 리포트를 보고 내일 행동을 확실하게 정해주세요.

원하는 답변 형식:

1. 내일 매수 가능 / 보류 / 관망 중 하나로 결론
2. 볼 종목은 몇 개인지
3. 키움 예약매수를 넣어도 되는지
4. 시장가 매수 또는 추격매수 금지 여부
5. 손절가가 없으면 매수 금지 여부
6. 내가 실제로 해야 할 행동을 순서대로 지시
7. 마지막에 한 문장으로 결론

아래는 U턴스캐너 리포트입니다.`;

// ───────────────────────────────────────────────────────────────
// v0.8-4 통합 빌더 — ChatGPT 요청 + 판단 리포트 + 부록(기존 상세)
// v0.8-4.2: 최상단에 CHATGPT_RECHECK_PROMPT 추가
// ───────────────────────────────────────────────────────────────
export function buildCombinedReport(
  judgment: JudgmentReportInput,
  detailed: GptReportInput,
): string {
  const parts: string[] = [];
  // v0.8-4.2 최상단 고정 지시문
  parts.push(CHATGPT_RECHECK_PROMPT);
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(buildJudgmentReport(judgment));
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('# 부록: 기존 상세 행동 리포트');
  parts.push('> 아래는 v0.7 까지 사용하던 상세 행동/보유/예약 점검 리포트입니다.');
  parts.push('> ChatGPT 가 추가 맥락이 필요할 때 참고하세요.');
  parts.push('');
  parts.push(buildGptReport(detailed));
  return parts.join('\n');
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
