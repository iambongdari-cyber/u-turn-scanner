'use client';
// app/beginner/_components/TopBrief.tsx
// v0.4-2 클라이언트 — 오늘 결론 + 오늘 할 일 + 꼭 보세요 통합 영역
//
// 서버 컴포넌트는 plans (localStorage) 를 못 읽으므로,
// 이 클라이언트 컴포넌트가 plans + rows + priceMap 을 합쳐서
// brief / selectedNewTargets 를 계산하고 3개 섹션을 렌더한다.

import { useEffect, useState } from 'react';
import { BeginnerRow } from '../../_lib/beginner';
import { ActionRecommend, TradePlan } from '../../_lib/trade_plan';
import { loadAllPlans } from '../../_lib/trade_storage';
import {
  TodayBrief,
  TodayBriefItem,
  buildTodayBrief,
  selectTradePlanTargets,
} from '../../_lib/today_brief';
import { buildAllBriefItems } from '../../_lib/gpt_report';
import MustSeeSection from './MustSeeSection';

interface Props {
  rows: BeginnerRow[];
  priceByTicker: Record<string, number>;
  previousJudgementByTicker?: Record<string, ActionRecommend>;
  baseDate: string | null;
  /** v0.5 전략 모드 (AGGRESSIVE / SELECTIVE / DEFENSIVE) — undefined 시 SELECTIVE */
  regimeMode?: 'AGGRESSIVE' | 'SELECTIVE' | 'DEFENSIVE';
}

interface BriefState {
  brief: TodayBrief;
  selectedNewTargets: TodayBriefItem[];
}

const EMPTY_BRIEF: TodayBrief = {
  newTodayCount: 0,
  reservedCount: 0,
  holdingCount: 0,
  urgentCount: 0,
  interestCount: 0,
  headlineTodoCount: 0,
  todoActions: [],
  briefLines: [],
  dontDo: [
    '후보 전체 훑지 않기',
    '신규 예약매수 여러 개 넣지 않기',
    '손절가 없이 예약매수 넣지 않기',
  ],
};

export default function TopBrief({
  rows, priceByTicker, previousJudgementByTicker, baseDate, regimeMode,
}: Props) {
  const [state, setState] = useState<BriefState>({
    brief: EMPTY_BRIEF,
    selectedNewTargets: [],
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const recompute = () => {
      const plans: TradePlan[] = loadAllPlans();
      const priceMap = new Map<string, number>(Object.entries(priceByTicker));
      const prevMap = previousJudgementByTicker
        ? new Map<string, ActionRecommend>(Object.entries(previousJudgementByTicker))
        : undefined;
      const briefItems = buildAllBriefItems({
        rows,
        plans,
        priceMap,
        previousJudgementMap: prevMap,
      });
      const newItems = briefItems.filter(i => i.urgency.kind === 'NEW_CANDIDATE');
      const reservedItems = briefItems.filter(i => i.urgency.kind === 'RESERVED');
      const holdingItems = briefItems.filter(i => i.urgency.kind === 'HOLDING');
      const hasHoldingOrReserved = reservedItems.length + holdingItems.length > 0;
      const selectedNewTargets = selectTradePlanTargets(newItems, hasHoldingOrReserved, regimeMode);
      const interestCount = newItems.filter(i => i.urgency.level === 'INTEREST').length;
      const brief = buildTodayBrief({
        selectedNewTargets,
        reservedItems,
        holdingItems,
        interestCount,
      });
      setState({ brief, selectedNewTargets });
    };
    recompute();
    const handler = (e: StorageEvent) => {
      if (!e.key || e.key === 'tradePlans') recompute();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, rows, priceByTicker, previousJudgementByTicker, regimeMode]);

  // 자식 컴포넌트에서 상태 변경 시 recompute
  // (현재 미사용 — MyPlansSection 안의 storage event 가 자동 처리)
  void setReloadKey;

  // v0.4-5: baseDate prop 은 더 이상 사용하지 않지만 호출처(page.tsx) 시그니처 유지
  void baseDate;

  // v0.6: brief 는 page.tsx 의 TodayConclusion (regime 기반) 이 대신함
  // TopBrief 는 MustSeeSection (매매계획 기록 대상) 만 렌더
  void state.brief;

  return <MustSeeSection selectedNewTargets={state.selectedNewTargets} />;
}
