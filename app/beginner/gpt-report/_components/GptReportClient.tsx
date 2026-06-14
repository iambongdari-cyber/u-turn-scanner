'use client';
// app/beginner/gpt-report/_components/GptReportClient.tsx
// v0.7.4 GPT 리포트 페이지 — 클라이언트 영역
//
// 책임:
//  - 서버에서 받은 initialMarkdown 을 즉시 본문에 표시
//  - mount 후 localStorage 의 plans 가 있으면 보유/예약 종목 포함된 markdown 으로 자동 업데이트
//  - [전체 선택] 버튼 (보조)
//  - 본문은 어떤 경우에도 화면에 보임 (JS 실패해도 SSR 본문 그대로 노출)

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadAllPlans } from '../../../_lib/trade_storage';
import { buildGptReport, buildAll } from '../../../_lib/gpt_report';
import { BeginnerRow } from '../../../_lib/beginner';
import { ActionRecommend } from '../../../_lib/trade_plan';
import { MarketRegimeResult, buildConclusionText } from '../../../_lib/market_regime';
import { evaluateStrategyCondition } from '../../../_lib/strategy_condition';

interface Props {
  base_date: string | null;
  rows: BeginnerRow[];
  priceByTicker: Record<string, number>;
  previousJudgementByTicker?: Record<string, ActionRecommend>;
  marketRegime: MarketRegimeResult | null;
  /** 서버에서 미리 생성한 markdown (plans=[] 기준) — JS 실패 시 fallback */
  initialMarkdown: string;
}

export default function GptReportClient({
  base_date, rows, priceByTicker, previousJudgementByTicker, marketRegime, initialMarkdown,
}: Props) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [enhanced, setEnhanced] = useState(false);
  const [selectedHint, setSelectedHint] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);

  // 클라이언트 mount 후 localStorage plans 합쳐서 markdown 재생성
  useEffect(() => {
    try {
      const plans = loadAllPlans();
      if (plans.length === 0) {
        // 보유/예약 없으면 서버 markdown 그대로 사용
        setEnhanced(true);
        return;
      }
      const priceMap = new Map<string, number>(Object.entries(priceByTicker));
      const prevMap = previousJudgementByTicker
        ? new Map<string, ActionRecommend>(Object.entries(previousJudgementByTicker))
        : undefined;
      const condition = evaluateStrategyCondition(plans);
      const { briefItems, selectedNewTargets } = buildAll({
        rows,
        plans,
        priceMap,
        previousJudgementMap: prevMap,
        regimeMode: marketRegime?.mode,
        conditionState: condition.state,
      });

      let regimeForReport = marketRegime ?? null;
      if (regimeForReport) {
        const topPickName = selectedNewTargets[0]?.name ?? null;
        const syncedConclusion = buildConclusionText(regimeForReport.regime, regimeForReport.mode, topPickName);
        regimeForReport = { ...regimeForReport, conclusionText: syncedConclusion };
      }

      const md = buildGptReport({
        base_date,
        rows,
        plans,
        currentPriceByTicker: priceMap,
        previousJudgementByTicker: prevMap,
        briefItems,
        selectedNewTargets,
        marketRegime: regimeForReport,
      });
      if (md && md.trim().length > 0) {
        setMarkdown(md);
        setEnhanced(true);
      }
    } catch {
      // 실패해도 initialMarkdown 그대로 표시
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectAll = () => {
    try {
      if (preRef.current) {
        const range = document.createRange();
        range.selectNodeContents(preRef.current);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        preRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const ua = navigator?.userAgent ?? '';
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
        setSelectedHint(
          isMobile
            ? '✋ 텍스트가 선택되었습니다. 길게 눌러 복사를 선택하세요.'
            : '⌨ 텍스트가 선택되었습니다. Ctrl+C (Mac: ⌘+C) 로 복사하세요.'
        );
        setTimeout(() => setSelectedHint(null), 6000);
      }
    } catch {
      setSelectedHint('선택에 실패했습니다. 본문을 직접 길게 눌러 복사해주세요.');
    }
  };

  return (
    <>
      {/* 액션 영역 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={selectAll}
          className="rounded-md border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          전체 선택
        </button>
        <Link
          href="/beginner"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          ← 홈으로 돌아가기
        </Link>
        {enhanced && (
          <span className="text-[10px] text-slate-500">
            ※ 현재 기기 저장 데이터 (보유/예약/컨디션) 반영됨
          </span>
        )}
      </div>

      {selectedHint && (
        <div className="mt-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {selectedHint}
        </div>
      )}

      {/* 본문 — 인라인 항상 표시 */}
      <pre
        ref={preRef}
        className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[13px] leading-relaxed text-slate-800 sm:text-[14px]"
        style={{
          userSelect: 'text',
          WebkitUserSelect: 'text',
          cursor: 'text',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {markdown}
      </pre>

      <p className="mt-2 text-[11px] text-slate-500">
        💡 본문을 길게 눌러서(모바일) 또는 마우스로 드래그(PC)하여 직접 복사할 수도 있습니다.
      </p>
    </>
  );
}
