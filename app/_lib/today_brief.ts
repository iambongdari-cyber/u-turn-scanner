// app/_lib/today_brief.ts
// v0.4-2 "지시형 오늘의 투자판단" — 확인 필요도 + 오늘 결론 + 오늘 할 일
//
// 핵심 (v0.4-2):
// - "꼭 보세요"는 후보 조건 충족 종목이 아니라 "오늘 실제 행동이 필요한 종목"만.
// - 신규 후보는 아무리 많아도 "오늘 매매계획 기록 대상"으로 선정된 1~3개만 노출.
// - 보유/예약이 있으면 신규 후보는 최대 1개.
// - "오늘 신규로 볼 종목 138건" 같은 큰 숫자 표현 제거.

import {
  TradePlan,
  ActionRecommend,
  isHoldingStatus,
  isReservedStatus,
  calculateAvgBuyPrice,
} from './trade_plan';
import { BeginnerRow, judgeRow, BeginnerVerdict } from './beginner';
import { evaluateProximity, buildHoldingOpinion, buildReservationOpinion } from './scoring';

// ───────────────────────────────────────────────────────────────
// 확인 필요도 5 등급
// ───────────────────────────────────────────────────────────────
export type UrgencyLevel = 'URGENT' | 'TODAY' | 'INTEREST' | 'LATER' | 'HIDDEN';

export const URGENCY_LABEL: Record<UrgencyLevel, string> = {
  URGENT: '긴급 확인',
  TODAY: '오늘 확인',
  INTEREST: '관심 확인',
  LATER: '나중에 확인',
  HIDDEN: '숨김',
};

export const URGENCY_BADGE_CLASS: Record<UrgencyLevel, string> = {
  URGENT: 'bg-red-100 text-red-800 border-red-300',
  TODAY: 'bg-amber-100 text-amber-900 border-amber-300',
  INTEREST: 'bg-sky-100 text-sky-800 border-sky-300',
  LATER: 'bg-slate-100 text-slate-600 border-slate-300',
  HIDDEN: 'bg-slate-50 text-slate-500 border-slate-200',
};

export const URGENCY_ORDER: Record<UrgencyLevel, number> = {
  URGENT: 0,
  TODAY: 1,
  INTEREST: 2,
  LATER: 3,
  HIDDEN: 4,
};

// ───────────────────────────────────────────────────────────────
// 종목 유형 (지시형 카드용)
// ───────────────────────────────────────────────────────────────
export type DirectiveKind = 'NEW_CANDIDATE' | 'RESERVED' | 'HOLDING';

export interface UrgencyInput {
  plan?: TradePlan | null;
  row?: BeginnerRow | null;
  currentPrice?: number | null;
  previousJudgement?: ActionRecommend | null;
}

export interface UrgencyResult {
  level: UrgencyLevel;
  kind: DirectiveKind;
  reasons: string[];
}

// ───────────────────────────────────────────────────────────────
// 메인 — 확인 필요도 계산
// ───────────────────────────────────────────────────────────────
export function computeUrgency(input: UrgencyInput): UrgencyResult {
  const { plan, row, currentPrice, previousJudgement } = input;

  if (plan && isReservedStatus(plan.status)) {
    return computeReservedUrgency(plan, currentPrice ?? null);
  }
  if (plan && isHoldingStatus(plan.status)) {
    return computeHoldingUrgency(plan, currentPrice ?? null, row ?? null);
  }
  if (row) {
    return computeNewCandidateUrgency(row, previousJudgement ?? null);
  }
  return { level: 'LATER', kind: 'NEW_CANDIDATE', reasons: [] };
}

// ───────────────────────────────────────────────────────────────
// 예약매수 대기
// ───────────────────────────────────────────────────────────────
function computeReservedUrgency(plan: TradePlan, currentPrice: number | null): UrgencyResult {
  if (currentPrice == null) {
    return { level: 'TODAY', kind: 'RESERVED', reasons: ['예약매수 대기 — 현재가 확인 필요'] };
  }
  const op = buildReservationOpinion(plan, currentPrice);
  const reasons: string[] = ['예약매수 대기 중'];

  if (currentPrice <= plan.stop_loss_price) {
    reasons.push('손절 기준가 이탈 — 예약 취소 검토');
    return { level: 'URGENT', kind: 'RESERVED', reasons };
  }
  if (op.diff1_pct > 5) {
    reasons.push(`현재가가 1차 예약가 대비 +${op.diff1_pct.toFixed(1)}% 멀어짐`);
    return { level: 'URGENT', kind: 'RESERVED', reasons };
  }
  reasons.push('예약가 근처 — 유지 확인');
  return { level: 'TODAY', kind: 'RESERVED', reasons };
}

// ───────────────────────────────────────────────────────────────
// 보유 종목
// ───────────────────────────────────────────────────────────────
function computeHoldingUrgency(
  plan: TradePlan,
  currentPrice: number | null,
  row: BeginnerRow | null,
): UrgencyResult {
  if (currentPrice == null) {
    return { level: 'TODAY', kind: 'HOLDING', reasons: ['보유 종목 — 현재가 확인 필요'] };
  }
  const reasons: string[] = [];
  const op = buildHoldingOpinion(plan, currentPrice, plan.add_buy_check);
  const prox = evaluateProximity(plan, currentPrice);

  if (currentPrice <= plan.stop_loss_price) {
    reasons.push('손절 기준가 이탈 — 매도 검토');
    return { level: 'URGENT', kind: 'HOLDING', reasons };
  }
  if (currentPrice >= plan.target_sell_price) {
    reasons.push('목표 매도가 도달 — 일부매도 검토');
    return { level: 'URGENT', kind: 'HOLDING', reasons };
  }
  if (prox.near_stop_loss) {
    reasons.push(`손절 기준가 근접 (${Math.abs(prox.to_stop_loss_pct).toFixed(1)}% 남음)`);
    return { level: 'URGENT', kind: 'HOLDING', reasons };
  }
  if (prox.near_target) {
    reasons.push(`목표 매도가 근접 (${Math.abs(prox.to_target_pct).toFixed(1)}% 남음)`);
    return { level: 'URGENT', kind: 'HOLDING', reasons };
  }
  if (op.verdict === 'PARTIAL_SELL' || op.verdict === 'SELL') {
    reasons.push('AI 판단이 매도 신호');
    return { level: 'URGENT', kind: 'HOLDING', reasons };
  }
  if (plan.add_buy_check && plan.add_buy_check.passed_count >= 4) {
    reasons.push('추가매수 조건 4/4 — 눌림 관찰');
    return { level: 'TODAY', kind: 'HOLDING', reasons };
  }
  reasons.push('보유 종목 — 일일 점검');
  return { level: 'TODAY', kind: 'HOLDING', reasons };
}

// ───────────────────────────────────────────────────────────────
// 신규 후보 — v0.4-2 매우 엄격하게 변경
// 기존 TODAY 기준이 너무 넓어 100+ 개가 잡혔던 문제 해결.
// 이제 대부분은 INTEREST/LATER 로 가고, 진짜 "오늘 매매계획 기록 대상"만 TODAY.
// ───────────────────────────────────────────────────────────────
function computeNewCandidateUrgency(
  row: BeginnerRow,
  previousJudgement: ActionRecommend | null,
): UrgencyResult {
  const v = judgeRow(row);
  const reasons: string[] = [];

  // 0) 숨김
  if (v.ai_judgement === 'EXCLUDE') {
    return { level: 'HIDDEN', kind: 'NEW_CANDIDATE', reasons: ['제외 종목 — 진입 비추천'] };
  }
  if (v.risk === 'HIGH' && v.uturn_passed <= 2) {
    return { level: 'HIDDEN', kind: 'NEW_CANDIDATE', reasons: ['위험 높음 + 조건 부족'] };
  }
  if (row.disparity_pct != null && row.disparity_pct >= 15) {
    // 추격 위험 임계 강화 (기존 18 → 15)
    return { level: 'HIDDEN', kind: 'NEW_CANDIDATE', reasons: [`이격 +${row.disparity_pct.toFixed(1)}% — 추격 위험`] };
  }

  // 1) 긴급 — AI 판단이 어제 대비 강하게 개선
  if (previousJudgement === 'EXCLUDE' && v.ai_judgement === 'BUY') {
    reasons.push('AI 판단 제외 → 매수 (강하게 개선)');
    return { level: 'URGENT', kind: 'NEW_CANDIDATE', reasons };
  }
  if (previousJudgement === 'WATCH' && v.ai_judgement === 'BUY') {
    reasons.push('AI 판단 관찰 → 매수 (개선)');
    return { level: 'URGENT', kind: 'NEW_CANDIDATE', reasons };
  }

  // 2) TODAY — v0.4-2 매우 엄격 (사용자 명세 §2)
  //    AI 매수 + 위험 낮음·보통 + U턴 4/5 이상 + 거래대금 회복 + 60일선 회복 + 추격 위험 아님
  const isBuyJudgement = v.ai_judgement === 'BUY';
  const lowOrMedRisk = v.risk === 'LOW' || v.risk === 'MED';
  const strongUTurn = v.uturn_passed >= 4;
  const volumeRecovered = row.checks?.value_recovering === true;
  const valueOk = row.checks?.value_ok === true;
  const ma60Recovered = row.checks?.above_ma60 === true;
  const notOverheated = row.disparity_pct == null || row.disparity_pct < 12;

  if (
    isBuyJudgement &&
    lowOrMedRisk &&
    strongUTurn &&
    (volumeRecovered || valueOk) &&
    ma60Recovered &&
    notOverheated
  ) {
    reasons.push('AI 매수');
    reasons.push(`U턴 ${v.uturn_passed}/5`);
    if (volumeRecovered) reasons.push('거래대금 회복');
    if (ma60Recovered) reasons.push('60일선 회복');
    if (v.risk === 'LOW') reasons.push('위험 낮음');
    return { level: 'TODAY', kind: 'NEW_CANDIDATE', reasons };
  }

  // 3) INTEREST — 관찰/매수 단계 + U턴 3/5 이상 (기존 매수 후보지만 거래대금/추세 조건 모자란 케이스)
  if (
    (v.ai_judgement === 'WATCH' || v.ai_judgement === 'BUY') &&
    v.uturn_passed >= 3
  ) {
    reasons.push('관찰 또는 매수 단계 — 흐름 변화 있음');
    reasons.push(`U턴 ${v.uturn_passed}/5`);
    return { level: 'INTEREST', kind: 'NEW_CANDIDATE', reasons };
  }

  // 4) 나중에 — 약함
  reasons.push(`U턴 ${v.uturn_passed}/5 — 약함`);
  return { level: 'LATER', kind: 'NEW_CANDIDATE', reasons };
}

// ───────────────────────────────────────────────────────────────
// 지시형 카드 컨텐츠 빌드 (왜 봐야 하나 / 이대로 하세요 / 기록하세요)
// ───────────────────────────────────────────────────────────────
export interface DirectiveContent {
  why_see: string[];
  do_now: string[];
  record: string[];
}

export function buildDirective(
  urgency: UrgencyResult,
  context: {
    plan?: TradePlan | null;
    row?: BeginnerRow | null;
    verdict?: BeginnerVerdict | null;
    currentPrice?: number | null;
  },
): DirectiveContent {
  const { plan, row, verdict, currentPrice } = context;
  const why_see: string[] = [];
  const do_now: string[] = [];
  const record: string[] = [];

  if (urgency.kind === 'NEW_CANDIDATE' && row) {
    const v = verdict ?? judgeRow(row);
    if (v.uturn_passed >= 4) why_see.push(`U턴 신호 ${v.uturn_passed}/5`);
    if (v.risk === 'LOW') why_see.push('위험 낮음');
    else if (v.risk === 'MED') why_see.push('위험 보통');
    if (row.checks?.value_recovering) why_see.push('거래대금 회복');
    else if (row.checks?.value_ok) why_see.push('거래대금 임계 충족');
    if (row.checks?.above_ma60) why_see.push('60일선 회복');
    if (urgency.reasons[0]?.includes('판단')) why_see.push(urgency.reasons[0]);

    if (urgency.level === 'URGENT' || urgency.level === 'TODAY') {
      do_now.push('매매계획 기록을 먼저 합니다.');
      do_now.push('1차 예약매수가와 손절가를 확인합니다.');
      do_now.push('키움 예약매수는 직접 입력합니다.');
    } else {
      do_now.push('아직 매매 계획은 보류');
      do_now.push('내일 종가/거래량 변화 다시 확인');
      do_now.push('충동 진입 금지');
    }
    record.push('매매 계획 기록');
    return { why_see, do_now, record };
  }

  if (urgency.kind === 'RESERVED' && plan) {
    why_see.push('키움 예약매수 대기 중인 종목입니다.');
    if (currentPrice != null) {
      const op = buildReservationOpinion(plan, currentPrice);
      if (op.verdict === 'CANCEL') why_see.push('손절 기준가 이탈 — 예약 취소 검토');
      else if (op.verdict === 'REVIEW') why_see.push('현재가가 예약가 대비 멀어짐');
      else why_see.push('현재가가 예약가 근처에 있습니다.');
    }
    do_now.push('키움 예약 유지 확인');
    do_now.push('체결되면 [1차 체결] 클릭 + 실제 체결가 입력');
    do_now.push('손절 기준 이탈 시 예약 취소');
    record.push('미체결');
    record.push('1차 체결');
    record.push('2차 체결');
    record.push('취소');
    return { why_see, do_now, record };
  }

  if (urgency.kind === 'HOLDING' && plan) {
    why_see.push('보유 종목입니다.');
    if (currentPrice != null) {
      const op = buildHoldingOpinion(plan, currentPrice, plan.add_buy_check);
      if (op.verdict === 'PARTIAL_SELL') why_see.push('목표 매도가 도달 — 일부매도 검토');
      else if (op.verdict === 'SELL') why_see.push('손절 기준가 이탈 — 매도 검토');
      else if (op.verdict === 'BUY_MORE_WAIT' && plan.add_buy_check) {
        why_see.push(`추가매수 조건 ${plan.add_buy_check.passed_count}/4 충족`);
        why_see.push('단, 지금 추격매수는 금지입니다.');
      } else {
        why_see.push(`현재 수익률 ${op.pnl_pct >= 0 ? '+' : ''}${op.pnl_pct.toFixed(1)}%`);
      }
      for (const a of op.today_actions.slice(0, 3)) do_now.push(a);
    } else {
      do_now.push('키움에서 현재가/수익률 확인');
      do_now.push('목표가/손절가 변동 시 [수정] 클릭');
    }
    record.push('목표가 수정');
    record.push('손절가 수정');
    record.push('상태 변경');
    return { why_see, do_now, record };
  }

  return { why_see, do_now, record };
}

// ───────────────────────────────────────────────────────────────
// 매매계획 기록 대상 선정 (사용자 명세 §2)
// 신규 후보 중 화면에 노출할 종목 — 1~3개 제한 + 보유/예약 있으면 최대 1개
// ───────────────────────────────────────────────────────────────
export interface TodayBriefItem {
  ticker: string;
  name: string;
  urgency: UrgencyResult;
  plan?: TradePlan | null;
  row?: BeginnerRow | null;
  currentPrice?: number | null;
}

/** v0.5 전략 모드 — 외부 import 회피를 위해 string union 으로 받음 */
export type SelectRegimeMode = 'AGGRESSIVE' | 'SELECTIVE' | 'DEFENSIVE';

export function selectTradePlanTargets(
  newItems: TodayBriefItem[],
  hasHoldingOrReserved: boolean,
  regimeMode?: SelectRegimeMode,
): TodayBriefItem[] {
  // TODAY 또는 URGENT 등급의 신규 후보만 후보
  const pool = newItems.filter(i =>
    i.urgency.kind === 'NEW_CANDIDATE' &&
    (i.urgency.level === 'URGENT' || i.urgency.level === 'TODAY') &&
    i.row
  );
  if (pool.length === 0) return [];

  // v0.5 모드별 가중치 분기
  const mode: SelectRegimeMode = regimeMode ?? 'SELECTIVE';

  // 점수: URGENT > TODAY, U턴 충족 + 위험 낮음 + 거래대금 회복 + 60일선
  const scored = pool.map(it => {
    const v = judgeRow(it.row!);
    let score = v.uturn_passed * 10;
    if (it.urgency.level === 'URGENT') score += 30;
    if (v.risk === 'LOW') score += 8;
    else if (v.risk === 'MED') score += 3;
    if (it.row?.checks?.value_recovering) score += 5;
    if (it.row?.checks?.above_ma60) score += 3;
    if (it.row?.disparity_pct != null && it.row.disparity_pct < 5) score += 3;
    if (v.ai_judgement === 'BUY') score += 5;

    // ── v0.5 모드별 분기
    if (mode === 'AGGRESSIVE') {
      // 강세장: 주도주 +10, 후발 +5, 추격 위험 종목(이격 ≥12%) 강한 감점
      if (v.category === 'CURRENT_LEADER') score += 10;
      else if (v.category === 'LATE_STRONG') score += 5;
      if (it.row?.disparity_pct != null && it.row.disparity_pct >= 12) score -= 20;
    } else if (mode === 'SELECTIVE') {
      // 보합장: 거래대금 회복 가중 + 손절가 근거(ma60) 불명확하면 강감점
      if (it.row?.checks?.value_recovering) score += 10;
      if (it.row?.ma60 == null) score -= 50;
    } else if (mode === 'DEFENSIVE') {
      // 약세장: 신규 후보 전체 감점 — 보유/예약 우선 (자연스럽게 1개 이하로 줄어듦)
      score -= 20;
    }

    return { item: it, score, uturn: v.uturn_passed, risk: v.risk };
  })
  .filter(s => s.score >= 0) // 모드 분기로 score 가 0 미만이면 사실상 제외
  .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  // v0.5 모드별 캡
  // - DEFENSIVE: 최대 1개
  // - SELECTIVE: 최대 1개 (사용자 명세 §보합장 "1순위만")
  // - AGGRESSIVE: 보유/예약 없으면 최대 3 (veryStrong 분기), 있으면 최대 1
  if (mode === 'DEFENSIVE' || mode === 'SELECTIVE') {
    return [scored[0].item];
  }

  // AGGRESSIVE
  if (hasHoldingOrReserved) {
    return [scored[0].item];
  }
  const veryStrong = scored.filter(s => s.uturn >= 5 && s.risk === 'LOW');
  if (veryStrong.length >= 2) {
    return veryStrong.slice(0, 3).map(s => s.item);
  }
  return [scored[0].item];
}

// ───────────────────────────────────────────────────────────────
// 오늘 할 일 액션 — 사용자 명세 §3, §7
// ───────────────────────────────────────────────────────────────
export interface TodayAction {
  text: string;                        // "NAVER 매매계획 기록"
  ticker?: string;
  /** 'top1' = 오늘 1순위 (사용자가 최소한 이것만은 한다), 'secondary' = 시간 있으면 추가 확인 */
  priority: 'top1' | 'secondary';
}

export interface TodayBrief {
  // 카운트 (내부용 — UI 큰 표시 X)
  newTodayCount: number;           // 매매계획 기록 대상으로 선정된 신규
  reservedCount: number;
  holdingCount: number;
  urgentCount: number;
  interestCount: number;

  // v0.4-2 신규: 오늘 할 일 액션 리스트 + 헤드라인
  headlineTodoCount: number;       // 오늘 할 일 N개
  todoActions: TodayAction[];      // 번호 매긴 액션
  briefLines: string[];            // 결론 보조 (작게 표시)

  // 오늘 하지 말아야 할 행동
  dontDo: string[];
}

export interface BuildBriefInput {
  selectedNewTargets: TodayBriefItem[];     // 매매계획 기록 대상 (1~3)
  reservedItems: TodayBriefItem[];          // 예약매수 대기 전체
  holdingItems: TodayBriefItem[];           // 보유 전체
  interestCount: number;                    // 관심 등급 카운트 (보조 표시용)
}

export function buildTodayBrief(input: BuildBriefInput): TodayBrief {
  const { selectedNewTargets, reservedItems, holdingItems, interestCount } = input;

  // 모든 후보 액션을 한 번 만들고 우선순위를 나중에 부여
  type Draft = { text: string; ticker?: string; score: number };
  const drafts: Draft[] = [];

  // 점수 규칙 — 점수 높을수록 시급
  //  - 보유 URGENT (손절 이탈/목표 도달/근접): 100
  //  - 예약 URGENT (손절 이탈/가격 재검토): 90
  //  - 보유 일반 (일일 점검): 60
  //  - 예약 일반 (예약 유지 확인): 50
  //  - 신규 매매계획 1순위 (selectedNewTargets[0]): 80
  //  - 신규 매매계획 2~3번째: 30

  // 1) 신규 매매계획 기록 대상
  for (let i = 0; i < selectedNewTargets.length; i++) {
    const it = selectedNewTargets[i];
    drafts.push({
      text: `${it.name} — 매매계획 기록 후 예약매수 여부 판단`,
      ticker: it.ticker,
      score: i === 0 ? 80 : 30,
    });
  }

  // 2) 예약매수 대기
  for (const it of reservedItems) {
    if (it.urgency.level === 'URGENT') {
      const reason = it.urgency.reasons.find(r => r.includes('이탈') || r.includes('멀어짐')) ?? '재점검';
      drafts.push({
        text: `${it.name} — 예약 ${reason.includes('이탈') ? '취소 검토' : '가격 재검토'}`,
        ticker: it.ticker,
        score: 90,
      });
    } else {
      drafts.push({ text: `${it.name} — 예약 유지 확인`, ticker: it.ticker, score: 50 });
    }
  }

  // 3) 보유
  for (const it of holdingItems) {
    if (it.urgency.level === 'URGENT') {
      const r = it.urgency.reasons[0] ?? '재점검';
      let act = '재점검';
      if (r.includes('손절')) act = '매도 검토';
      else if (r.includes('목표')) act = '일부매도 검토';
      else if (r.includes('매도 신호')) act = '판단 재확인';
      drafts.push({ text: `${it.name} — ${act}`, ticker: it.ticker, score: 100 });
    } else if (it.plan?.add_buy_check && it.plan.add_buy_check.passed_count >= 4) {
      drafts.push({
        text: `${it.name} — 보유 유지, 추가매수 금지 (눌림 관찰)`,
        ticker: it.ticker,
        score: 60,
      });
    } else {
      drafts.push({ text: `${it.name} — 보유 유지`, ticker: it.ticker, score: 60 });
    }
  }

  // 점수 내림차순 정렬 후 최상위 1개 = top1, 나머지 = secondary
  drafts.sort((a, b) => b.score - a.score);
  const todoActions: TodayAction[] = drafts.map((d, i) => ({
    text: d.text,
    ticker: d.ticker,
    priority: i === 0 ? 'top1' : 'secondary',
  }));

  // 헤드라인 보조 텍스트
  const briefLines: string[] = [];
  briefLines.push(`오늘 신규 매매계획 대상: ${selectedNewTargets.length}개`);
  briefLines.push(`예약매수 대기: ${reservedItems.length}개`);
  briefLines.push(`보유종목: ${holdingItems.length}개`);
  if (interestCount > 0) {
    briefLines.push(`참고 후보는 아래 접힘 영역에 있습니다.`);
  }

  // 오늘 하지 말아야 할 행동
  const dontDo: string[] = [
    '후보 전체를 훑지 않기',
    '신규 예약매수 여러 개 넣지 않기',
    '손절가 없이 예약매수 넣지 않기',
  ];
  if (holdingItems.length > 0) {
    dontDo.push('보유종목 추가매수는 눌림 전까지 금지');
  }
  if (selectedNewTargets.length === 0 && reservedItems.length === 0 && holdingItems.length === 0) {
    dontDo.push('오늘은 매매하지 않기 — 관찰만');
  }

  const urgentCount =
    selectedNewTargets.filter(i => i.urgency.level === 'URGENT').length +
    reservedItems.filter(i => i.urgency.level === 'URGENT').length +
    holdingItems.filter(i => i.urgency.level === 'URGENT').length;

  return {
    newTodayCount: selectedNewTargets.length,
    reservedCount: reservedItems.length,
    holdingCount: holdingItems.length,
    urgentCount,
    interestCount,
    headlineTodoCount: todoActions.length,
    todoActions,
    briefLines,
    dontDo,
  };
}

// ───────────────────────────────────────────────────────────────
// 오늘 매매계획 추천 1순위 — selectTradePlanTargets 첫 번째 그대로 사용
// ───────────────────────────────────────────────────────────────
export interface TopPickResult {
  pick: BeginnerRow | null;
  reasonForNone: string | null;
}

export function selectTopPick1st(
  selectedNewTargets: TodayBriefItem[],
  holdingCount: number,
  urgentHoldingCount: number,
): TopPickResult {
  if (urgentHoldingCount > 0) {
    return {
      pick: null,
      reasonForNone: '오늘은 보유종목 점검이 긴급합니다. 신규 매매보다 보유 판단이 우선입니다.',
    };
  }
  if (selectedNewTargets.length === 0) {
    if (holdingCount > 0) {
      return {
        pick: null,
        reasonForNone: '오늘은 신규 매수보다 보유/예약 상태 점검이 우선입니다.',
      };
    }
    return {
      pick: null,
      reasonForNone: '오늘 신규 매수 후보 중 강한 신호가 잡히지 않았습니다.',
    };
  }
  const first = selectedNewTargets[0];
  return { pick: first.row ?? null, reasonForNone: null };
}

// ───────────────────────────────────────────────────────────────
// 평균 매수가 재export
// ───────────────────────────────────────────────────────────────
export { calculateAvgBuyPrice };
