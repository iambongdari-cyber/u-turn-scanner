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
  const { data: report } = await supabase
    .from('reports')
    .select('id, base_date')
    .eq('report_type', 'daily')
    .order('base_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!report) {
    return (
      <main className="container mx-auto max-w-5xl p-6 sm:p-8">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">키움 자동감시 참고표</h1>
        <p className="mt-4 text-slate-600">아직 일일 리포트가 없습니다.</p>
      </main>
    );
  }

  const rep = report as any;

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

  return (
    <main className="container mx-auto max-w-5xl p-6 sm:p-8">
      <header className="mb-4">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">키움 자동감시 참고표</h1>
        <p className="mt-1 text-sm text-slate-600">최신 일일 리포트({rep.base_date}) 기준</p>
      </header>

      <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        이 화면은 키움 자동감시주문에 직접 입력하기 전 <strong>참고용으로 정리한 표</strong>입니다.
        <strong> 자동주문 기능이 아니며</strong>, 최종 입력과 주문 여부는 사용자가 키움에서 직접 확인해야 합니다.
        표시된 모든 가격은 보조 관찰 라벨일 뿐이며, 매매 권유가 아닙니다.
      </div>

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
                      <span className={`inline-flex rounded px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>
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
        </>
      )}
    </main>
  );
}
