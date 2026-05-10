import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Chart from './Chart';
import MemoForm from './MemoForm';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ reportId?: string }>;
}

interface Candle {
  time: string; open: number; high: number; low: number; close: number;
}

export default async function StockDetailPage({ params, searchParams }: PageProps) {
  const { ticker } = await params;
  const { reportId } = await searchParams;

  const { data: stock } = await supabase
    .from('stocks')
    .select('ticker, name, market')
    .eq('ticker', ticker)
    .maybeSingle();

  if (!stock) notFound();

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const fromDate = sixMonthsAgo.toISOString().split('T')[0];

  const { data: prices } = await supabase
    .from('daily_prices')
    .select('date, open, high, low, close, volume')
    .eq('ticker', ticker)
    .gte('date', fromDate)
    .order('date', { ascending: true });

  let scan: any = null;
  if (reportId) {
    const { data } = await supabase
      .from('scan_results')
      .select('*')
      .eq('report_id', reportId)
      .eq('ticker', ticker)
      .maybeSingle();
    scan = data;
  }

  let note: any = null;
  if (reportId) {
    const { data } = await supabase
      .from('stock_notes')
      .select('interest_level, my_decision, target_buy, target_stop, target_sell, free_memo')
      .eq('report_id', reportId)
      .eq('ticker', ticker)
      .maybeSingle();
    note = data;
  }

  const candles: Candle[] = (prices ?? []).map((p) => ({
    time: p.date,
    open: Number(p.open),
    high: Number(p.high),
    low: Number(p.low),
    close: Number(p.close),
  }));

  const volumes = (prices ?? []).map((p) => ({
    time: p.date,
    value: Number(p.volume) || 0,
    color: Number(p.close) >= Number(p.open) ? '#ef444488' : '#3b82f688',
  }));

  const closes = candles.map((c) => c.close);
  const ma10arr = computeMA(closes, 10);
  const ma20arr = computeMA(closes, 20);
  const ma60arr = computeMA(closes, 60);

  const toLine = (arr: (number | null)[]) =>
    arr
      .map((v, i) => (v != null ? { time: candles[i].time, value: v } : null))
      .filter((x): x is { time: string; value: number } => x !== null);

  const ma10 = toLine(ma10arr);
  const ma20 = toLine(ma20arr);
  const ma60 = toLine(ma60arr);

  const goldenMarkers: Array<{
    time: string; position: 'belowBar'; color: string;
    shape: 'arrowUp'; text: string;
  }> = [];
  for (let i = 1; i < candles.length; i++) {
    const p10 = ma10arr[i - 1], p60 = ma60arr[i - 1];
    const c10 = ma10arr[i], c60 = ma60arr[i];
    if (p10 != null && p60 != null && c10 != null && c60 != null
        && p10 <= p60 && c10 > c60) {
      goldenMarkers.push({
        time: candles[i].time,
        position: 'belowBar',
        color: '#ef4444',
        shape: 'arrowUp',
        text: 'GC',
      });
    }
  }

  return (
    <main className="container mx-auto max-w-7xl p-6">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold text-slate-800">{stock.name}</h1>
        <span className="text-slate-400">{stock.ticker}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {stock.market}
        </span>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        <div className="min-w-0 md:flex-1">
          {candles.length === 0 ? (
            <div className="rounded border border-slate-200 bg-slate-50 p-8 text-center text-slate-600">
              이 종목의 최근 일봉 데이터가 없습니다.
            </div>
          ) : (
            <Chart
              candles={candles}
              ma10={ma10}
              ma20={ma20}
              ma60={ma60}
              volumes={volumes}
              goldenMarkers={goldenMarkers}
            />
          )}
        </div>

        <aside className="space-y-6 md:w-80 md:flex-shrink-0">
          <div className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">            
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              조건 충족 여부
            </h2>
            {scan ? (
              <ul className="space-y-1.5 text-sm">
                <ConditionRow label="골든크로스 (≤5일)" pass={scan.cond_golden} />
                <ConditionRow label="종가 > 60일선" pass={scan.cond_above_ma60} />
                <ConditionRow label="60일선 상승 중" pass={scan.cond_ma60_rising} />
                <ConditionRow label="후행스팬 60일선 위" pass={scan.cond_lagging_ok} />
                <ConditionRow label="앞 구름 붉음" pass={scan.cond_cloud_red} />
              </ul>
            ) : (
              <p className="text-sm text-slate-500">
                이 종목은 해당 리포트의 후보에 없습니다.
              </p>
            )}
          </div>

          {scan && (
            <div className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">계산값</h2>
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-slate-500">점수</dt>
                <dd className="text-right tabular-nums">{Number(scan.score).toFixed(1)}</dd>
                <dt className="text-slate-500">판정</dt>
                <dd className="text-right">{scan.final_grade}</dd>
                <dt className="text-slate-500">이격도</dt>
                <dd className="text-right tabular-nums">
                  {scan.disparity_pct != null ? `${Number(scan.disparity_pct).toFixed(2)}%` : '-'}
                </dd>
                <dt className="text-slate-500">손절가</dt>
                <dd className="text-right tabular-nums">
                  {scan.stop_loss != null ? Number(scan.stop_loss).toLocaleString() : '-'}
                </dd>
                <dt className="text-slate-500">상승여력</dt>
                <dd className="text-right tabular-nums">
                  {scan.upside_pct != null ? `${Number(scan.upside_pct).toFixed(1)}%` : '-'}
                </dd>
                <dt className="text-slate-500">손익비</dt>
                <dd className="text-right tabular-nums">
                  {scan.rr_ratio != null ? Number(scan.rr_ratio).toFixed(2) : '-'}
                </dd>
                <dt className="text-slate-500">1차 매수후보가</dt>
                <dd className="text-right tabular-nums">
                  {scan.buy1_price != null ? Number(scan.buy1_price).toLocaleString() : '-'}
                </dd>
                <dt className="text-slate-500">2차 매수후보가</dt>
                <dd className="text-right tabular-nums">
                  {scan.buy2_price != null ? Number(scan.buy2_price).toLocaleString() : '-'}
                </dd>
              </dl>
              {scan.one_line && (
                <p className="mt-4 rounded bg-slate-50 p-3 text-xs text-slate-700">
                  {scan.one_line}
                </p>
              )}
            </div>
          )}

          {reportId && (
            <MemoForm reportId={reportId} ticker={ticker} initial={note} />
          )}
        </aside>
      </div>
    </main>
  );
}

function ConditionRow({ label, pass }: { label: string; pass: boolean | null }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-slate-700">{label}</span>
      <span className={pass ? 'text-green-600 font-bold text-base' : 'text-slate-400'}>
        {pass ? '○' : '·'}
      </span>
    </li>
  );
}

function computeMA(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      out.push(sum / period);
    }
  }
  return out;
}