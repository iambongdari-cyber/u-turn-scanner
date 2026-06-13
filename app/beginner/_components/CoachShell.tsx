'use client';
// app/beginner/_components/CoachShell.tsx
// v0.6.1 코치 쉘 — selectTradePlanTargets 를 한 번만 호출하고
// TodayConclusion 과 MustSeeSection 양쪽에 동일한 selectedNewTargets 전달.
//
// 사용자 명세 §3:
//  - 오늘의 결론과 매매계획 기록 대상이 항상 동일한 데이터를 참조
//  - 별도 추천 로직 중복 사용 금지

import { ReactNode, useEffect, useState } from 'react';
import { BeginnerRow } from '../../_lib/beginner';
import { ActionRecommend } from '../../_lib/trade_plan';
import { loadAllPlans } from '../../_lib/trade_storage';
import {
  TodayBriefItem,
  selectTradePlanTargets,
} from '../../_lib/today_brief';
import { buildAllBriefItems } from '../../_lib/gpt_report';
import { MarketRegimeResult } from '../../_lib/market_regime';
import TodayConclusion from './TodayConclusion';
import MustSeeSection from './MustSeeSection';

interface Props {
  regime: MarketRegimeResult | null;
  rows: BeginnerRow[];
  priceByTicker: Record<string, number>;
  previousJudgementByTicker?: Record<string, ActionRecommend>;
  /** §1~§4 영역 (MarketRegimeBox + StrategyConditionBox + Recommended/Forbidden) */
  middleBoxes: ReactNode;
}

export default function CoachShell({
  regime, rows, priceByTicker, previousJudgementByTicker, middleBoxes,
}: Props) {
  const [selectedNewTargets, setSelectedNewTargets] = useState<TodayBriefItem[]>([]);

  useEffect(() => {
    const recompute = () => {
      const plans = loadAllPlans();
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
      const targets = selectTradePlanTargets(newItems, hasHoldingOrReserved, regime?.mode);
      setSelectedNewTargets(targets);
    };
    recompute();
    const handler = (e: StorageEvent) => {
      if (!e.key || e.key === 'tradePlans') recompute();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, priceByTicker, previousJudgementByTicker, regime?.mode]);

  // v0.6.1: 1순위 종목명 — 양쪽에 동일 데이터로 전달되므로 절대 다르지 않음
  const topPickName = selectedNewTargets[0]?.name ?? null;

  return (
    <>
      {/* §0 오늘의 결론 — topPickName 동기화 */}
      <TodayConclusion regime={regime} topPickName={topPickName} />

      {/* §1~§4 영역 (page.tsx 에서 children 으로 전달) */}
      {middleBoxes}

      {/* §5 매매계획 기록하기 — 동일한 selectedNewTargets */}
      <MustSeeSection selectedNewTargets={selectedNewTargets} />
    </>
  );
}
