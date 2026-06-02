import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface Note {
  report_id: string;
  ticker: string;
  interest_level: string | null;
  my_decision: string | null;
  target_buy: number | null;
  target_stop: number | null;
  target_sell: number | null;
  free_memo: string | null;
}

interface ScanContext {
  ticker: string;
  close: number | null;
  score: number | null;
  final_grade: string | null;
  golden_days_ago: number | null;
  disparity_pct: number | null;
  buy1_price: number | null;
  buy2_price: number | null;
  stop_loss: number | null;
  one_line: string | null;
  stocks: { name: string } | null;
}

function gradeLabel(g: string | null): string {
  if (g === 'A' || g === 'B') return '기회 후보';
  if (g === 'CHASE_RISK') return '추격 위험';
  if (g === 'WATCH' || g === 'EXCLUDE') return '조건 부족';
  return '관찰';
}

function stagePhrase(daysAgo: number | null | undefined): string {
  if (daysAgo == null) return '바닥 관찰';
  if (daysAgo <= 1) return 'U턴 시도';
  if (daysAgo <= 5) return 'U턴 확인';
  return '추세전환 후보';
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '-';
  return Math.round(Number(n)).toLocaleString();
}

export default async function JournalPage() {
  const { data: notesData } = await supabase
    .from('stock_notes')
    .select('report_id, ticker, interest_level, my_decision, target_buy, target_stop, target_sell, free_memo')
    .order('report_id', { ascending: false })
    .limit(30);

  const notes = (notesData ?? []) as unknown as Note[];

  const tickers = Array.from(new Set(notes.map(n => n.ticker)));
  const scanByTicker = new Map<string, ScanContext>();
  if (tickers.length > 0) {
    const { data: scans } = await supabase
      .from('scan_results')
      .select(`ticker, close, score, final_grade, golden_days_ago, disparity_pct,
               buy1_price, buy2_price, stop_loss, one_line,
               stocks ( name )`)
      .in('ticker', tickers)
      .order('ticker', { ascending: true });
    for (const s of ((scans ?? []) as unknown as ScanContext[])) {
      if (!scanByTicker.has(s.ticker)) scanByTicker.set(s.ticker, s);
    }
  }

  return (
    <main className="container mx-auto max-w-3xl p-6 sm:p-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">매매일지 초안</h1>
        <p className="mt-1 text-sm text-slate-600">
          관심종목 메모와 스캔 컨텍스트를 묶어 보여줍니다. 관찰·복기 보조용 초안이며 매매 권유가 아닙니다.
        </p>
      </header>

      {notes.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-8 text-center text-slate-600">
          등록된 메모가 없습니다.
          <br />
          <span className="text-sm text-slate-500">
            종목 상세 화면의 메모 입력칸을 채우면 여기에 일지 초안이 만들어집니다.
          </span>
        </div>
      ) : (
        <ul className="space-y-4">
          {notes.map(n => {
            const ctx = scanByTicker.get(n.ticker);
            const stage = stagePhrase(ctx?.golden_days_ago ?? null);
            const gLabel = gradeLabel(ctx?.final_grade ?? null);
            return (
              <li key={`${n.report_id}-${n.ticker}`} className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <Link href={`/stocks/${n.ticker}`} className="text-lg font-semibold text-slate-800 hover:underline">
                    {ctx?.stocks?.name ?? n.ticker}
                  </Link>
                  <span className="text-xs text-slate-500">{n.ticker}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">단계: {stage}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">분류: {gLabel}</span>
                  {n.interest_level && (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800">관심도 {n.interest_level}</span>
                  )}
                  {n.my_decision && (
                    <span className="rounded bg-purple-100 px-2 py-0.5 text-purple-800">내 판단 {n.my_decision}</span>
                  )}
                </div>

                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded border border-slate-200 bg-slate-50 p-2">
                    <p className="mb-1 text-xs text-slate-500">스캔 컨텍스트(최신)</p>
                    <div className="tabular-nums">
                      종가 {fmtPrice(ctx?.close)}
                      {ctx?.score != null && <span className="ml-2">· 점수 {Number(ctx.score).toFixed(1)}</span>}
                    </div>
                    <div className="text-xs text-slate-600">
                      {ctx?.disparity_pct != null && <>이격 {Number(ctx.disparity_pct).toFixed(1)}% · </>}
                      {ctx?.golden_days_ago != null && <>GC경과 {ctx.golden_days_ago}일</>}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-2">
                    <p className="mb-1 text-xs text-slate-500">내가 기록한 관찰 기준</p>
                    <div className="space-y-0.5 text-xs tabular-nums text-slate-700">
                      <div>진입 관찰가: {fmtPrice(n.target_buy)}</div>
                      <div>손절 기준: {fmtPrice(n.target_stop)}</div>
                      <div>청산 관찰가: {fmtPrice(n.target_sell)}</div>
                    </div>
                  </div>
                </div>

                {ctx?.one_line && (
                  <p className="mt-2 text-xs text-slate-600">한 줄 요약: {ctx.one_line}</p>
                )}
                {n.free_memo && (
                  <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                    <p className="mb-1 text-xs text-slate-500">자유 메모</p>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{n.free_memo}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-xs text-slate-500">
        본 화면은 관찰·복기 보조용 초안입니다. 어떤 표시도 매매 권유가 아니며, 최종 판단은 사용자 본인이 합니다.
      </p>
    </main>
  );
}
