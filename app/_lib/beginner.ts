// app/_lib/beginner.ts
// v0.4 오늘의 투자판단 — 분류 / U턴 / 왜 뽑혔나 / 행동 체크리스트
//
// ※ 모든 문구는 "관찰 보조" 표현. 매수/매도 추천이 아닙니다.
// ※ AI 판단은 개인 기록용. 실제 최종 결정은 사용자가 합니다.

import {
  ActionRecommend,
  BeginnerCategory,
  RiskLevel,
  UTurnConditions,
  countUTurnConditions,
  deriveUTurnStageLevel,
  UTurnStageLevel,
} from './trade_plan';

// ───────────────────────────────────────────────────────────────
// 행 입력 타입 — scan_dump 의 candidates_bottom item + sector 컨텍스트
// ───────────────────────────────────────────────────────────────
export interface BeginnerRow {
  ticker: string;
  name: string;
  sector?: string | null;
  market?: string | null;
  stage?: string | null;
  close?: number | null;
  ma60?: number | null;
  disparity_pct?: number | null;
  golden_days_ago?: number | null;
  days_below_ma60_60d?: number | null;
  value_ratio?: number | null;            // 거래대금 회복 배수
  avg_value_20_eok?: number | null;       // 20일 평균 거래대금(억)
  checks?: {
    uturn_ok?: boolean;
    value_recovering?: boolean;
    ma60_rising?: boolean;
    lagging_ok?: boolean;
    cloud_red?: boolean;
    above_ma60?: boolean;
    value_ok?: boolean;
  } | null;
  evidence?: string[];
  news_critical?: boolean;
  classification?: string | null;         // 사이드카 sector 분류 (진짜 주도주 후보 등)
}

// ───────────────────────────────────────────────────────────────
// U턴 5조건 — 사용자 명세 §3
// ───────────────────────────────────────────────────────────────
export function buildUTurnConditions(row: BeginnerRow): UTurnConditions {
  const c = row.checks ?? {};
  return {
    // ✔ 충분한 하락 + 바닥 머무름 — uturn_ok (60일 중 60일선 아래 10일 이상)
    enough_drop_and_bottom: c.uturn_ok === true,
    // ✔ 60일선 위로 회복
    recover_above_ma60: c.above_ma60 === true,
    // ✔ 거래량 회복 — value_recovering
    volume_recovery: c.value_recovering === true,
    // ✔ 거래대금 임계 충족 — value_ok
    value_threshold: c.value_ok === true,
    // ✔ 60일선 추세 상향 — ma60_rising
    ma60_trend_up: c.ma60_rising === true,
  };
}

// ───────────────────────────────────────────────────────────────
// 카테고리 분류
// ───────────────────────────────────────────────────────────────
export function deriveCategory(row: BeginnerRow): BeginnerCategory {
  // 진짜 주도주 후보 = 현재 주도주
  if (row.classification === '진짜 주도주 후보') return 'CURRENT_LEADER';
  // 후발주 관찰 / 기회 후보 = 후발 강세 후보
  if (row.classification === '후발주 관찰' || row.classification === '기회 후보') return 'LATE_STRONG';
  // 그 외 (바닥 관찰/U턴 시도/U턴 확인/추세전환 후보 + 분류 없음) = 바닥 U턴 후보
  return 'BOTTOM_UTURN';
}

// ───────────────────────────────────────────────────────────────
// 위험도 평가
// ───────────────────────────────────────────────────────────────
export function deriveRisk(row: BeginnerRow): RiskLevel {
  // 뉴스 위험 = HIGH
  if (row.news_critical) return 'HIGH';
  // 이격 +20% 이상 = HIGH
  if (row.disparity_pct != null && row.disparity_pct >= 20) return 'HIGH';
  // 이격 +12~20% = MED
  if (row.disparity_pct != null && row.disparity_pct >= 12) return 'MED';
  // 거래대금 임계 미달 = MED
  if (row.checks?.value_ok === false) return 'MED';
  // 그 외 = LOW
  return 'LOW';
}

// ───────────────────────────────────────────────────────────────
// AI 판단 (사용자 명세 §2)
// ───────────────────────────────────────────────────────────────
export function deriveAiJudgement(row: BeginnerRow): ActionRecommend {
  // 뉴스 위험 또는 추격 위험 강함 → 제외
  if (row.news_critical) return 'EXCLUDE';
  // 이격 +20% 이상 → 제외 (추격 위험)
  if (row.disparity_pct != null && row.disparity_pct >= 20) return 'EXCLUDE';

  const u = buildUTurnConditions(row);
  const n = countUTurnConditions(u);

  // 5개 모두 충족 → 매수
  if (n >= 5) return 'BUY';
  // 4개 충족 → 매수
  if (n === 4) return 'BUY';
  // 3개 → 관찰
  if (n === 3) return 'WATCH';
  // 그 외 → 관찰 (제외는 별도 위험 조건만)
  return 'WATCH';
}

// ───────────────────────────────────────────────────────────────
// 왜 뽑혔나 (사용자 명세 §3)
// ───────────────────────────────────────────────────────────────
export function buildWhyPicked(row: BeginnerRow): string[] {
  const out: string[] = [];
  if (row.evidence && row.evidence.length > 0) {
    out.push(...row.evidence.slice(0, 4));
  }
  // 보강 — 사이드카에 없으면 직접 추가
  if (out.length === 0) {
    if (row.checks?.uturn_ok) out.push('충분한 하락 + 바닥 머무름');
    if (row.checks?.above_ma60) out.push('60일선 위로 회복');
    if (row.checks?.value_recovering) out.push('거래량 회복');
    if (row.checks?.value_ok) out.push('거래대금 임계 충족');
  }
  // disparity 정보 한 줄 추가
  if (row.disparity_pct != null) {
    out.push(`이격 ${row.disparity_pct.toFixed(1)}%`);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────
// 초보자 행동 가이드 (사용자 명세 §3)
// ───────────────────────────────────────────────────────────────
export function buildBeginnerChecklist(row: BeginnerRow, judgement: ActionRecommend): string[] {
  const out: string[] = [];

  if (judgement === 'EXCLUDE') {
    out.push('지금 진입은 추천하지 않습니다.');
    if (row.news_critical) out.push('뉴스/공시 위험 — 사실관계 확인 후 결정.');
    if (row.disparity_pct != null && row.disparity_pct >= 20) out.push('이격 +20% 이상 — 추격 위험 구간.');
    return out;
  }

  if (judgement === 'BUY') {
    out.push('1차 매수가 근처 도달 시 키움에서 예약매수 검토.');
    out.push('손절가 이탈 시 즉시 손절 — 추격매수 금지.');
    if (row.disparity_pct != null && row.disparity_pct >= 10) {
      out.push('이격이 다소 벌어진 상태 — 분할 진입 검토.');
    } else {
      out.push('2차 매수가는 60일선 근처 눌림에서 확인.');
    }
    return out;
  }

  // WATCH
  out.push('아직 진입은 이릅니다 — 추가 신호 확인 필요.');
  if (row.checks?.ma60_rising === false) out.push('60일선 추세 상향 확인 후 다시 검토.');
  if (row.checks?.value_ok === false) out.push('거래대금 임계 충족 여부 추가 확인.');
  out.push('내일 종가 + 거래량 변화 확인 후 결정.');
  return out;
}

// ───────────────────────────────────────────────────────────────
// 카테고리별 한 줄 요약
// ───────────────────────────────────────────────────────────────
export function categoryHeadline(cat: BeginnerCategory): string {
  switch (cat) {
    case 'BOTTOM_UTURN':
      return '오랜 하락을 마치고 60일선 위로 회복 중인 종목 — 바닥 U턴 후보입니다.';
    case 'CURRENT_LEADER':
      return '같은 섹터 안에서 거래대금과 가격 위치가 동시에 좋은 종목 — 현재 주도주입니다.';
    case 'LATE_STRONG':
      return '주도주를 뒤따라가는 후발 강세 후보 — 주도주 흐름 유지 시 추가 관찰.';
  }
}

// ───────────────────────────────────────────────────────────────
// U턴 단계 표현 — 사용자 명세 §3
// 예: "U턴 신호 단계: 강함 5개 조건 중 4개 충족"
// ───────────────────────────────────────────────────────────────
export function uturnStageHeadline(c: UTurnConditions): string {
  const level = deriveUTurnStageLevel(c);
  const n = countUTurnConditions(c);
  const levelLabel =
    level === 'VERY_STRONG' ? '매우 강함' :
    level === 'STRONG' ? '강함' :
    level === 'WATCH' ? '관찰' :
    '약함';
  return `U턴 신호 단계: ${levelLabel} 5개 조건 중 ${n}개 충족`;
}

// ───────────────────────────────────────────────────────────────
// 통합 — 한 행에 대한 전체 판단 (UI 가 한 번에 받기 좋게)
// ───────────────────────────────────────────────────────────────
export interface BeginnerVerdict {
  category: BeginnerCategory;
  risk: RiskLevel;
  ai_judgement: ActionRecommend;
  uturn_conditions: UTurnConditions;
  uturn_stage_level: UTurnStageLevel;
  uturn_passed: number;
  uturn_headline: string;
  why_picked: string[];
  beginner_checklist: string[];
}

export function judgeRow(row: BeginnerRow): BeginnerVerdict {
  const category = deriveCategory(row);
  const risk = deriveRisk(row);
  const ai_judgement = deriveAiJudgement(row);
  const uturn_conditions = buildUTurnConditions(row);
  const uturn_stage_level = deriveUTurnStageLevel(uturn_conditions);
  const uturn_passed = countUTurnConditions(uturn_conditions);
  const uturn_headline = uturnStageHeadline(uturn_conditions);
  const why_picked = buildWhyPicked(row);
  const beginner_checklist = buildBeginnerChecklist(row, ai_judgement);
  return {
    category,
    risk,
    ai_judgement,
    uturn_conditions,
    uturn_stage_level,
    uturn_passed,
    uturn_headline,
    why_picked,
    beginner_checklist,
  };
}

// ───────────────────────────────────────────────────────────────
// 변경 이유 추천 칩 (사용자 명세 §8)
// ───────────────────────────────────────────────────────────────
export const TARGET_UP_REASONS = [
  '거래량 유지, 전고점 돌파 가능성',
  '외인 매수 지속',
  '추세 강화로 추가 상승 여지',
];

export const TARGET_DOWN_REASONS = [
  '상승 탄력 약화',
  '거래량 감소',
  '장기 횡보 우려',
];

export const STOP_UP_REASONS = [
  '1차 매수가 위 안정적 유지',
  '지지선 견고',
  '트레일링 스톱 적용',
];

export const STOP_DOWN_REASONS = [
  '단기 변동성 흡수 여유 확보',
  '지지선 재설정',
];

export function suggestTargetReasons(oldPrice: number, newPrice: number): string[] {
  if (newPrice > oldPrice) return TARGET_UP_REASONS;
  if (newPrice < oldPrice) return TARGET_DOWN_REASONS;
  return [...TARGET_UP_REASONS, ...TARGET_DOWN_REASONS];
}

export function suggestStopReasons(oldPrice: number, newPrice: number): string[] {
  if (newPrice > oldPrice) return STOP_UP_REASONS;
  if (newPrice < oldPrice) return STOP_DOWN_REASONS;
  return [...STOP_UP_REASONS, ...STOP_DOWN_REASONS];
}
