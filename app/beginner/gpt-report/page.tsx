// app/beginner/gpt-report/page.tsx
// v0.7.4 GPT 상담용 리포트 페이지 (서버 SSR)
//
// 모바일에서 onClick / 모달 / 인라인 펼침 모두 안정성이 떨어지는 문제를 해결하기 위해
// 별도 페이지로 분리. 브라우저의 일반 링크 이동이라 JS 실패 환경에서도 동작.
//
// 서버 데이터 기준으로 markdown 미리 생성 → SSR 렌더 → 본문이 어떤 환경에서도 보임.
// 클라이언트 컴포넌트가 mount 후 localStorage plans 합쳐서 더 정확한 markdown 으로 업데이트.

import Link from 'next/link';
import { loadBeginnerData, loadPreviousScanRows } from '../../_lib/beginner_data';
import { judgeRow } from '../../_lib/beginner';
import { ActionRecommend } from '../../_lib/trade_plan';
import { buildAll, buildCombinedReport } from '../../_lib/gpt_report';
import { buildConclusionText } from '../../_lib/market_regime';
import { classifyStockCharacter } from '../../_lib/stock_character';
import { buildTomorrowAction } from '../../_lib/tomorrow_action';
import { evaluateStrategyCondition } from '../../_lib/strategy_condition';
import GptReportClient from './_components/GptReportClient';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface PageProps {
  searchParams?: Promise<{ date?: string }>;
}

export default async function GptReportPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const rawDate = typeof sp.date === 'string' ? sp.date : undefined;
  const requestedDate = rawDate && DATE_RE.test(rawDate) ? rawDate : undefined;

  const data = await loadBeginnerData(requestedDate);
  const prevScan = await loadPreviousScanRows(requestedDate);

  const priceByTicker: Record<string, number> = {};
  for (const [t, p] of data.priceByTicker.entries()) priceByTicker[t] = p;

  const previousJudgementByTicker: Record<string, ActionRecommend> = {};
  for (const r of prevScan.rows) {
    previousJudgementByTicker[r.ticker] = judgeRow(r).ai_judgement;
  }

  // ── 서버 측 markdown 생성 (plans = [] 가정)
  // localStorage 의 plans 는 클라이언트 mount 후 합쳐서 자동 업데이트됨
  let initialMarkdown = '';
  let buildError: string | null = null;

  try {
    const priceMap = new Map<string, number>(Object.entries(priceByTicker));
    const prevMap = new Map<string, ActionRecommend>(Object.entries(previousJudgementByTicker));

    const { briefItems, selectedNewTargets } = buildAll({
      rows: data.rows,
      plans: [],
      priceMap,
      previousJudgementMap: prevMap,
      regimeMode: data.marketRegime?.mode,
      // conditionState 는 plans 없으면 항상 DATA_INSUFFICIENT
    });

    let regimeForReport = data.marketRegime ?? null;
    if (regimeForReport) {
      const topPickName = selectedNewTargets[0]?.name ?? null;
      const syncedConclusion = buildConclusionText(regimeForReport.regime, regimeForReport.mode, topPickName);
      regimeForReport = { ...regimeForReport, conclusionText: syncedConclusion };
    }

    // v0.8-4 판단 리포트용 추가 데이터 계산 (plans=[] 기준)
    const condition = evaluateStrategyCondition([]);
    const topPick = selectedNewTargets[0] ?? null;
    const stockCharacter = regimeForReport
      ? classifyStockCharacter({
          row: topPick?.row ?? null,
          regime: regimeForReport.regime,
          conditionState: condition.state,
          sectorFlow: data.sectorFlow ?? null,
        })
      : null;
    const reservedItems = briefItems.filter(i => i.urgency.kind === 'RESERVED');
    const holdingItems = briefItems.filter(i => i.urgency.kind === 'HOLDING');
    const hasHoldingOrReserved = reservedItems.length + holdingItems.length > 0;
    const tomorrowAction = regimeForReport
      ? buildTomorrowAction({
          regime: regimeForReport.regime,
          conditionState: condition.state,
          topPickName: topPick?.name ?? null,
          hasHoldingOrReserved,
          strongCandidateCount: selectedNewTargets.length,
          stockCharacter: stockCharacter?.character ?? null,
        })
      : null;

    initialMarkdown = buildCombinedReport(
      {
        base_date: data.base_date,
        marketRegime: regimeForReport,
        marketStrength: data.marketStrength,
        capStyle: data.capStyle,
        sectorFlow: data.sectorFlow,
        stockCharacter,
        tomorrowAction,
        strategyCondition: condition,
        topPick,
      },
      {
        base_date: data.base_date,
        rows: data.rows,
        plans: [],
        currentPriceByTicker: priceMap,
        previousJudgementByTicker: prevMap,
        briefItems,
        selectedNewTargets,
        marketRegime: regimeForReport,
        strategyCondition: condition,
      },
    );
    if (!initialMarkdown || initialMarkdown.trim().length === 0) {
      buildError = '리포트 본문이 비어 있습니다.';
    }
  } catch (e) {
    buildError = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="border-b border-slate-200 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">💬 GPT에게 다시 물어보기</h1>
          <Link href="/beginner" className="text-sm text-indigo-600 hover:underline">
            ← 홈으로
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          U턴스캐너의 판단을 복사해서 ChatGPT 에게 한 번 더 점검받습니다.
        </p>
        {data.base_date && (
          <p className="mt-0.5 text-xs text-slate-500">기준일: {data.base_date}</p>
        )}
      </header>

      {buildError ? (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">⚠ 리포트 생성 실패</div>
          <div className="mt-1 text-xs">{buildError}</div>
          <Link
            href="/beginner"
            className="mt-2 inline-block rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            홈으로 돌아가기
          </Link>
        </div>
      ) : (
        <GptReportClient
          base_date={data.base_date}
          rows={data.rows}
          priceByTicker={priceByTicker}
          previousJudgementByTicker={previousJudgementByTicker}
          marketRegime={data.marketRegime}
          marketStrength={data.marketStrength}
          capStyle={data.capStyle}
          sectorFlow={data.sectorFlow}
          initialMarkdown={initialMarkdown}
        />
      )}

      <footer className="mt-6 border-t border-slate-200 pt-3 text-xs text-slate-500">
        <p>※ 이 리포트는 개인 기록용 AI 판단입니다. 실제 최종 결정은 사용자가 합니다.</p>
        <p className="mt-1">※ 보유/예약 종목 정보는 현재 기기 저장 데이터를 기반으로 반영됩니다 — 다른 기기에서 보면 다를 수 있습니다.</p>
      </footer>
    </main>
  );
}
