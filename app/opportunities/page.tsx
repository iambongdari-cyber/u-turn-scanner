import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface ScanRow {
  rank: number;
  ticker: string;
  score: number;
  close: number | null;
  final_grade: string | null;
  one_line: string | null;
  disparity_pct: number | null;
  golden_days_ago: number | null;
  stocks: { name: string; market: string } | null;
}

function labelOf(grade: string | null): { label: string; cls: string } {
  if (grade === 'A' || grade === 'B') return { label: '기회 후보', cls: 'bg-green-100 text-green-800' };
  if (grade === 'CHASE_RISK') return { label: '추격 위험', cls: 'bg-orange-100 text-orange-800' };
  if (grade === 'WATCH' || grade === 'EXCLUDE') return { label: '조건 부족', cls: 'bg-slate-200 text-slate-700' };
  return { label: '관찰', cls: 'bg-slate-100 text-slate-600' };
}

function stageOf(daysAgo: number | null): string {
  if (daysAgo == null) return '바닥 관찰';
  if (daysAgo <= 1) return 'U턴 시도';
  if (daysAgo <= 5) return 'U턴 확인';
  return '추세전환 후보';
}

export default async function OpportunitiesPage() {
  const { data: report } = await supabase
    .from('reports')
    .select('id, base_date')
    .eq('report_type', 'daily')
    .order('base_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!report) {
    return (
      <main className="container mx-auto max-w-3xl p-6 sm:p-8">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">오늘의 기회 포착판</h1>
        <p className="mt-4 text-slate-600">아직 일일 리포트가 없습니다.</p>
      </main>
    );
  }

  const rep = report as any;

  const { data, error } = await supabase
    .from('scan_results')
    .select(`rank, ticker, score, close, final_grade, one_line, disparity_pct, golden_days_ago,
             stocks ( name, market )`)
    .eq('report_id', rep.id)
    .order('rank', { ascending: true });

  if (error) {
    return (
      <main className="container mx-auto max-w-3xl p-6 sm:p-8">
        <p className="text-red-600">DB 조회 오류: {error.message}</p>
      </main>
    );
  }

  const rows = (data ?? []) as unknown as ScanRow[];
  const opportunity = rows.filter(r => r.final_grade === 'A' || r.final_grade === 'B');
  const chase = rows.filter(r => r.final_grade === 'CHASE_RISK');
  const insufficient = rows.filter(r => r.final_grade === 'WATCH' || r.final_grade === 'EXCLUDE');

  return (
    <main className="container mx-auto max-w-3xl p-6 sm:p-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">오늘의 기회 포착판</h1>
        <p className="mt-1 text-sm text-slate-600">
          최신 일일 리포트({rep.base_date}) 기준. 표시는 관찰 보조 분류이며 매매 권유가 아닙니다.
        </p>
      </header>

      <Section title="🎯 기회 후보" rows={opportunity} emptyMsg="오늘은 기회 후보가 없습니다." />
      <Section title="⚠️ 추격 위험" rows={chase} emptyMsg="추격 위험 표시 종목이 없습니다." />
      <Section title="🕒 조건 부족" rows={insufficient} emptyMsg="조건 부족 종목이 없습니다." />

      <p className="mt-6 text-xs text-slate-500">
        분류 라벨은 보조 표시입니다. 어떤 종목도 매매 권유가 아니며, 최종 판단은 사용자 본인이 합니다.
      </p>
    </main>
  );
}

function Section({ title, rows, emptyMsg }: { title: string; rows: ScanRow[]; emptyMsg: string }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-base font-semibold text-slate-800">
        {title} <span className="ml-2 text-xs text-slate-500">{rows.length}개</span>
      </h2>
      {rows.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{emptyMsg}</div>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => {
            const m = labelOf(r.final_grade);
            const stage = stageOf(r.golden_days_ago);
            return (
              <li key={r.ticker} className="rounded border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/stocks/${r.ticker}`} className="font-medium text-slate-800 hover:underline">
                    {r.stocks?.name ?? r.ticker}
                    <span className="ml-2 text-xs text-slate-400">{r.ticker}</span>
                  </Link>
                  <div className="flex gap-1">
                    <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                      {stage}
                    </span>
                    <span className={`inline-flex rounded px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>
                  </div>
                </div>
                <div className="mt-1 text-xs tabular-nums text-slate-500">
                  점수 {Number(r.score).toFixed(1)}
                  {r.close != null && <> · 종가 {Number(r.close).toLocaleString()}</>}
                  {r.disparity_pct != null && <> · 이격 {Number(r.disparity_pct).toFixed(1)}%</>}
                </div>
                {r.one_line && <p className="mt-1 text-xs text-slate-600">{r.one_line}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
