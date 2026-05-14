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
  const colorMap: Record<string, string> = {
    A: 'bg-green-100 text-green-800',
    B: 'bg-blue-100 text-blue-800',
    WATCH: 'bg-yellow-100 text-yellow-800',
    CHASE_RISK: 'bg-orange-100 text-orange-800',
    EXCLUDE: 'bg-slate-100 text-slate-600',
  };
  const cls = grade ? (colorMap[grade] ?? 'bg-slate-100') : 'bg-slate-100';
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs ${cls}`}>
      {grade ?? '-'}
    </span>
  );
}