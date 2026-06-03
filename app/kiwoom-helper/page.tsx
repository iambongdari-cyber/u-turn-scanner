import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  loadSidecarBundle,
  stageBadgeClass,
  classificationBadgeClass,
  getStageDisplay,
  getClassificationDisplay,
  STAGE_ORDER,
  CLASSIFICATION_ORDER,
  type SidecarTickerContext,
} from '@/app/_lib/sidecar';

export const dynamic = 'force-dynamic';

interface Row {
  ticker: string;
  rank: number;
  close: number | null;
  ma60: number | null;
  disparity_pct: number | null;
  upside_pct: number | null;
  buy1_price: number | null;
  buy2_price: number | null;
  stop_loss: number | null;
  final_grade: string | null;
  stocks: { name: string; market: string } | null;
}

function labelOf(grade: string | null): { label: string; cls: string } {
  if (grade === 'A' || grade === 'B') return { label: '기회 후보', cls: 'bg-green-100 text-green-800' };
  if (grade === 'CHASE_RISK') return { label: '추격 위험', cls: 'bg-orange-100 text-orange-800' };
  if (grade === 'WATCH' || grade === 'EXCLUDE') return { label: '조건 부족', cls: 'bg-slate-200 text-slate-700' };
  return { label: '관찰', cls: 'bg-slate-100 text-slate-600' };
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '-';
  return Math.round(Number(n)).toLocaleString();
}

export default async function KiwoomHelperPage() {
  const [reportRes, sidecar] = await Promise.all([
    supabase
      .from('reports')
      .select('id, base_date')
      .eq('report_type', 'daily')
      .order('base_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadSidecarBundle(),
  ]);
  const report = reportRes.data;

  if (!report) {
    return (
      <main className="container mx-auto max-w-5xl p-6 sm:p-8">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">키움 자동감시 참고표</h1>
        <p className="mt-4 text-slate-600">아직 일일 리포트가 없습니다.</p>
      </main>
    );
  }

  const rep = report as unknown as { id: string; base_date: string };

  const { data, error } = await supabase
    .from('scan_results')
    .select(`ticker, rank, close, ma60, disparity_pct, upside_pct,
             buy1_price, buy2_price, stop_loss, final_grade,
             stocks ( name, market )`)
    .eq('report_id', rep.id)
    .order('rank', { ascending: true });

  if (error) {
    return (
      <main className="container mx-auto max-w-5xl p-6 sm:p-8">
        <p className="text-red-600">DB 조회 오류: {error.message}</p>
      </main>
    );
  }

  const rows = (data ?? []) as unknown as Row[];

  // 사이드카 컨텍스트가 있는 종목만 모아 하단 "근거" 카드 섹션에서 사용
  const withCtx: Array<{ row: Row; ctx: SidecarTickerContext }> = [];
  for (const r of rows) {
    const ctx = sidecar.contexts.get(r.ticker);
    if (ctx && (ctx.stage || ctx.classification || ctx.evidence.length > 0 || ctx.chase_risk_reasons.length > 0 || ctx.news_critical)) {
      withCtx.push({ row: r, ctx });
    }
  }

  const sidecarStateNotice =
    (sidecar.scanMissing && sidecar.sectorMissing) ? (
      <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
        사이드카 분석 데이터가 아직 없습니다. <code className="rounded bg-slate-200 px-1">scripts/scan_dump.py</code> · <code className="rounded bg-slate-200 px-1">scripts/sector_dump.py</code> 실행 후 일부 라벨이 보강됩니다.
      </div>
    ) : (sidecar.scanError || sidecar.sectorError) ? (
      <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
        사이드카 일부 데이터를 읽지 못했습니다. 화면은 기존 데이터로 정상 표시됩니다.
      </div>
    ) : null;

  return (
    <main className="container mx-auto max-w-5xl p-6 sm:p-8">
      <header className="mb-4">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">키움 자동감시 참고표</h1>
        <p className="mt-1 text-sm text-slate-600">최신 일일 리포트({rep.base_date}) 기준</p>
      </header>

      <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        이 화면은 키움의 <strong>자동감시·관심종목 등록</strong> 시 손으로 입력할 가격을 <strong>참고용으로 정리한 표</strong>입니다.
        <strong> 자동주문/자동매수 기능과 무관</strong>하며, 키움 API 연동도 없습니다.
        최종 입력과 주문 여부는 사용자가 <strong>키움 HTS/MTS에서 직접 확인하고 결정</strong>합니다.
        표시된 모든 가격·라벨은 보조 관찰 표기일 뿐이며, 매매 권유가 아닙니다.
      </div>

      {/* v0.3-3: 8라벨 의미 빠른 참조표 */}
      <details className="mb-3 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
        <summary className="cursor-pointer text-slate-700">
          <strong>라벨 의미 빠른 참조</strong> — 단계 4개 · 분류 4개 (펼치기)
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-medium text-slate-500">단계 (바닥→추세)</p>
            <ul className="space-y-1">
              {STAGE_ORDER.map((s) => {
                const d = getStageDisplay(s);
                return (
                  <li key={s} className="flex items-start gap-1">
                    <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] ${stageBadgeClass(s)}`}>{d.icon} {s}</span>
                    <span className="text-[11px] text-slate-600">— {d.short}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium text-slate-500">분류 (섹터 안에서 위치)</p>
            <ul className="space-y-1">
              {CLASSIFICATION_ORDER.map((c) => {
                const d = getClassificationDisplay(c);
                return (
                  <li key={c} className="flex items-start gap-1">
                    <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] ${classificationBadgeClass(c)}`}>{d.icon} {c}</span>
                    <span className="text-[11px] text-slate-600">— {d.short}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          어떤 라벨도 매매 권유가 아닙니다. 진입·청산 가격은 사용자가 본인의 원칙에 따라 직접 결정합니다.
        </p>
      </details>

      {sidecarStateNotice}

      {rows.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-6 text-center text-slate-600">
          오늘 표시할 종목이 없습니다.
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-center">순</TableHead>
                <TableHead>종목</TableHead>
                <TableHead className="text-right">종가</TableHead>
                <TableHead className="text-right">돌파 확인가</TableHead>
                <TableHead className="text-right">눌림 1차</TableHead>
                <TableHead className="text-right">눌림 2차</TableHead>
                <TableHead className="text-right">위험 기준가</TableHead>
                <TableHead className="text-right">추격 주의가</TableHead>
                <TableHead>분류</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const m = labelOf(r.final_grade);
                let breakUp: number | null = null;
                if (r.close != null && r.upside_pct != null) {
                  breakUp = Number(r.close) * (1 + Number(r.upside_pct) / 100);
                }
                let chasePrice: number | null = null;
                if (r.ma60 != null) {
                  chasePrice = Number(r.ma60) * 1.2;
                }
                const ctx = sidecar.contexts.get(r.ticker);
                return (
                  <TableRow key={r.ticker}>
                    <TableCell className="text-center font-medium">{r.rank}</TableCell>
                    <TableCell>
                      <Link href={`/stocks/${r.ticker}`} className="text-blue-600 hover:underline">
                        {r.stocks?.name ?? r.ticker}
                      </Link>
                      <span className="ml-2 text-xs text-slate-400">{r.ticker}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.close)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(breakUp)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.buy1_price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.buy2_price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.stop_loss)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(chasePrice)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>
                        {ctx?.stage && (
                          <span className={`inline-flex rounded px-2 py-0.5 text-xs ${stageBadgeClass(ctx.stage)}`}>
                            {ctx.stage}
                          </span>
                        )}
                        {ctx?.classification && ctx.classification !== m.label && (
                          <span className={`inline-flex rounded px-2 py-0.5 text-xs ${classificationBadgeClass(ctx.classification)}`}>
                            {ctx.classification}
                          </span>
                        )}
                        {ctx?.news_critical && (
                          <span className="inline-flex rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
                            뉴스 위험 확인 필요
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="mt-4 space-y-1 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p><strong>돌파 확인가</strong>: 최근 60거래일 고가 추정. 이 가격대 위쪽 흐름 관찰용.</p>
            <p><strong>눌림 1차 / 2차</strong>: 10일선 / 20일선 근처. 단기 조정 시 관찰 위치.</p>
            <p><strong>위험 기준가</strong>: 보유자 대응 시 손절 기준 참고선(최근 20일 저가와 60일선 중 높은 쪽).</p>
            <p><strong>추격 주의가</strong>: 60일선 대비 +20% 위. 이 영역에서는 추격 위험이 커집니다.</p>
            <p className="pt-1 text-slate-500">
              * 가격은 모두 관찰 보조 라벨이며 매매 권유가 아닙니다. 최종 입력·주문은 사용자가 키움에서 직접 확인합니다.
            </p>
          </div>

          {withCtx.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-base font-semibold text-slate-800">
                사이드카 보강 컨텍스트
                <span className="ml-2 text-xs text-slate-500">{withCtx.length}개 종목</span>
              </h2>
              <p className="mb-2 text-xs text-slate-500">
                표의 종목 중 사이드카(`scan_dump`·`sector_dump`)에서 라벨이나 근거가 발견된 종목만 모아 보여줍니다. 관찰·복기 보조 용도이며 매매 권유가 아닙니다.
              </p>
              <ul className="space-y-2">
                {withCtx.map(({ row, ctx }) => (
                  <li key={row.ticker} className="rounded border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/stocks/${row.ticker}`} className="font-medium text-slate-800 hover:underline">
                        {row.stocks?.name ?? row.ticker}
                        <span className="ml-2 text-xs text-slate-400">{row.ticker}</span>
                      </Link>
                      <div className="flex flex-wrap gap-1">
                        {ctx.stage && (
                          <span className={`inline-flex rounded px-2 py-0.5 text-xs ${stageBadgeClass(ctx.stage)}`}>
                            {ctx.stage}
                          </span>
                        )}
                        {ctx.classification && (
                          <span className={`inline-flex rounded px-2 py-0.5 text-xs ${classificationBadgeClass(ctx.classification)}`}>
                            {ctx.classification}
                          </span>
                        )}
                        {ctx.sector && (
                          <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            섹터: {ctx.sector}
                          </span>
                        )}
                        {ctx.news_critical && (
                          <span className="inline-flex rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
                            뉴스 위험 확인 필요
                          </span>
                        )}
                      </div>
                    </div>
                    {ctx.evidence.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-xs text-slate-500">확인 근거</p>
                        <div className="flex flex-wrap gap-1">
                          {ctx.evidence.map((ev, i) => (
                            <span key={i} className="inline-flex rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
                              {ev}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {ctx.chase_risk_reasons.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-xs text-slate-500">조심할 점</p>
                        <div className="flex flex-wrap gap-1">
                          {ctx.chase_risk_reasons.map((rs, i) => (
                            <span key={i} className="inline-flex rounded bg-orange-50 px-2 py-0.5 text-[11px] text-orange-800">
                              {rs}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
