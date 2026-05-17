import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ requested?: string }>;
}

export default async function ReportPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { requested } = await searchParams;

  const { data: report, error: reportErr } = await supabase
    .from('reports')
    .select('id, report_type, base_date, is_final, created_at')
    .eq('id', id)
    .maybeSingle();

  if (reportErr || !report) {
    notFound();
  }

  const { data: results, error: resultErr } = await supabase
    .from('scan_results')
    .select(
      `rank, ticker, score, close, golden_days_ago, final_grade,
      stop_loss, upside_pct, rr_ratio,
      stocks ( name, market )`,
    )
    .eq('report_id', id)
    .order('rank', { ascending: true })
    .limit(10);

  if (resultErr) {
    return (
      <main className="container mx-auto p-8">
        <p className="text-red-600">DB 조회 오류: {resultErr.message}</p>
      </main>
    );
  }

  const rows = results ?? [];

  // financials를 별도 SELECT — 종목별 가장 최근 fiscal_year 한 행만 사용
  const tickers = rows.map((r: any) => r.ticker);
  const finMap = new Map<string, any>();
  if (tickers.length > 0) {
    const { data: fins } = await supabase
      .from('financials')
      .select('ticker, fiscal_year, fin_status')
      .in('ticker', tickers)
      .order('fiscal_year', { ascending: false });
    for (const f of fins ?? []) {
      if (!finMap.has(f.ticker)) finMap.set(f.ticker, f);
    }
  }

  // 시장 요약: KOSPI/KOSDAQ 최근 60거래일에서 ma60 계산
  const marketSummary = await loadMarketSummary();

  return (
    <main className="container mx-auto max-w-5xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">
          {report.report_type === 'daily' ? '일일' : '주간'} 리포트
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          기준일 {report.base_date}
          {report.is_final ? '' : ' (1차)'}
        </p>
         {requested && requested !== report.base_date && (
           <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
             선택한 날짜({requested})의 리포트가 없어 가장 가까운 이전 리포트({report.base_date})를 표시합니다.
           </p>
         )}
      </div>

      <MarketSummaryBox summary={marketSummary} />

      {rows.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-8 text-center text-slate-600">
          이 리포트에는 조건을 통과한 종목이 없습니다.
          <br />
          <span className="text-sm text-slate-500">
            (관심종목 풀이 작거나 시장 상황상 후보가 없을 수 있습니다)
          </span>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">순위</TableHead>
              <TableHead>종목명</TableHead>
              <TableHead className="w-20">시장</TableHead>
              <TableHead className="text-right">종가</TableHead>
              <TableHead className="text-right">점수</TableHead>
              <TableHead className="text-right">GC경과</TableHead>
              <TableHead className="text-right">손절가</TableHead>
              <TableHead className="text-right">상승여력</TableHead>
              <TableHead className="text-right">손익비</TableHead>
              <TableHead>판정</TableHead>
              <TableHead>재무</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r: any) => (
              <TableRow key={r.ticker}>
                <TableCell className="text-center font-medium">{r.rank}</TableCell>
                <TableCell>
                  <Link
                    href={`/stocks/${r.ticker}?reportId=${id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {r.stocks?.name ?? r.ticker}
                  </Link>
                  <span className="ml-2 text-xs text-slate-400">{r.ticker}</span>
                </TableCell>
                <TableCell>{r.stocks?.market ?? '-'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.close ? Number(r.close).toLocaleString() : '-'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.score != null ? Number(r.score).toFixed(1) : '-'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.golden_days_ago != null ? `${r.golden_days_ago}일전` : '-'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.stop_loss != null ? Math.round(Number(r.stop_loss)).toLocaleString() : '-'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.upside_pct != null ? `${Number(r.upside_pct).toFixed(1)}%` : '-'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.rr_ratio != null ? Number(r.rr_ratio).toFixed(2) : '-'}
                </TableCell>
                <TableCell>
                  <GradeBadge grade={r.final_grade} />
                </TableCell>
                <TableCell>
                  <FinBadge status={finMap.get(r.ticker)?.fin_status ?? null} />
                </TableCell>
                <TableCell>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/stocks/${r.ticker}?reportId=${id}`}>
                      차트보기
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}

function GradeBadge({ grade }: { grade: string | null }) {
  const labelMap: Record<string, string> = {
    A: 'A급',
    B: 'B급',
    WATCH: '관망',
    CHASE_RISK: '추격주의',
    EXCLUDE: '제외',
  };
  const colorMap: Record<string, string> = {
    A: 'bg-green-100 text-green-800',
    B: 'bg-blue-100 text-blue-800',
    WATCH: 'bg-yellow-100 text-yellow-800',
    CHASE_RISK: 'bg-orange-100 text-orange-800',
    EXCLUDE: 'bg-slate-100 text-slate-600',
  };
  const label = grade ? (labelMap[grade] ?? grade) : '-';
  const cls = grade ? (colorMap[grade] ?? 'bg-slate-100') : 'bg-slate-100';
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs ${cls}`}>
      {label}
    </span>
  );
}

function FinBadge({ status }: { status: string | null }) {
  const labelMap: Record<string, string> = {
    OK: '정상',
    WARN: '주의',
    HIGH_RISK: '고위험',
    NO_DATA: '데이터없음',
  };
  const colorMap: Record<string, string> = {
    OK: 'bg-green-100 text-green-800',
    WARN: 'bg-yellow-100 text-yellow-800',
    HIGH_RISK: 'bg-red-100 text-red-800',
    NO_DATA: 'bg-slate-100 text-slate-500',
  };
  const label = status ? (labelMap[status] ?? status) : '-';
  const cls = status ? (colorMap[status] ?? 'bg-slate-100') : 'bg-slate-100 text-slate-500';
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs ${cls}`}>
      {label}
    </span>
  );
}


// ── 시장 요약 ──────────────────────────────────────────────────
interface IndexInfo {
  name: 'KOSPI' | 'KOSDAQ';
  date: string;
  close: number;
  change_pct: number | null;
  above_ma60: boolean;
}

interface MarketSummary {
  kospi: IndexInfo | null;
  kosdaq: IndexInfo | null;
  status: '강세' | '중립' | '약세';
}

async function loadMarketSummary(): Promise<MarketSummary> {
  async function loadOne(name: 'KOSPI' | 'KOSDAQ'): Promise<IndexInfo | null> {
    const { data } = await supabase
      .from('market_indices')
      .select('date, close, change_pct')
      .eq('index_name', name)
      .order('date', { ascending: false })
      .limit(60);
    if (!data || data.length < 60) return null;
    const closes = data.map((d: any) => Number(d.close));
    const ma60 = closes.reduce((a, b) => a + b, 0) / 60;
    const latest = data[0];
    return {
      name,
      date: latest.date,
      close: Number(latest.close),
      change_pct: latest.change_pct != null ? Number(latest.change_pct) : null,
      above_ma60: Number(latest.close) > ma60,
    };
  }

  const [kospi, kosdaq] = await Promise.all([loadOne('KOSPI'), loadOne('KOSDAQ')]);
  let status: '강세' | '중립' | '약세' = '중립';
  if (kospi && kosdaq) {
    const aboveCount = (kospi.above_ma60 ? 1 : 0) + (kosdaq.above_ma60 ? 1 : 0);
    if (aboveCount === 2) status = '강세';
    else if (aboveCount === 0) status = '약세';
    else status = '중립';
  }
  return { kospi, kosdaq, status };
}

function MarketSummaryBox({ summary }: { summary: MarketSummary }) {
  if (!summary.kospi && !summary.kosdaq) return null;

  const statusColor =
    summary.status === '강세' ? 'bg-green-100 text-green-800' :
    summary.status === '약세' ? 'bg-red-100 text-red-800' :
                                  'bg-slate-200 text-slate-700';

  return (
    <div className="mb-6 rounded-md border border-slate-300 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">시장 요약</h2>
        <span className={`inline-flex rounded px-2 py-0.5 text-xs ${statusColor}`}>
          시장 상태: {summary.status}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {summary.kospi && <IndexRow info={summary.kospi} />}
        {summary.kosdaq && <IndexRow info={summary.kosdaq} />}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        강세: 두 지수 모두 60일선 위 / 중립: 하나만 / 약세: 둘 다 60일선 아래
      </p>
    </div>
  );
}

function IndexRow({ info }: { info: IndexInfo }) {
  const changeColor =
    info.change_pct == null ? 'text-slate-500' :
    info.change_pct > 0 ? 'text-red-600' :
    info.change_pct < 0 ? 'text-blue-600' :
                            'text-slate-500';
  const ma60Cls = info.above_ma60
    ? 'bg-green-100 text-green-800'
    : 'bg-orange-100 text-orange-800';
  return (
    <div className="flex items-center justify-between rounded bg-slate-50 px-3 py-2">
      <div>
        <span className="font-medium text-slate-700">{info.name}</span>
        <span className="ml-2 tabular-nums">{info.close.toLocaleString()}</span>
        {info.change_pct != null && (
          <span className={`ml-2 tabular-nums ${changeColor}`}>
            {info.change_pct > 0 ? '+' : ''}{info.change_pct.toFixed(2)}%
          </span>
        )}
      </div>
      <span className={`inline-flex rounded px-2 py-0.5 text-xs ${ma60Cls}`}>
        60일선 {info.above_ma60 ? '위' : '아래'}
      </span>
    </div>
  );
}