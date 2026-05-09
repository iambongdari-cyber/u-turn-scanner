import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const { data: reports, error } = await supabase
    .from('reports')
    .select('id, report_type, base_date, is_final, created_at')
    .order('base_date', { ascending: false })
    .order('report_type', { ascending: true })
    .limit(60);

  if (error) {
    return (
      <main className="container mx-auto p-8">
        <p className="text-red-600">DB 조회 오류: {error.message}</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← 메인으로
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">과거 리포트</h1>
        <p className="mt-1 text-sm text-slate-600">
          최근 60개의 리포트를 날짜 내림차순으로 표시합니다.
        </p>
      </header>

      {!reports || reports.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-8 text-center text-slate-600">
          저장된 리포트가 없습니다.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-300 bg-white shadow-sm">
          {reports.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <span className={`mr-2 inline-block rounded px-2 py-0.5 text-xs ${
                  r.report_type === 'daily'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-purple-100 text-purple-800'
                }`}>
                  {r.report_type === 'daily' ? '일일' : '주간'}
                </span>
                <span className="font-medium tabular-nums">{r.base_date}</span>
                {!r.is_final && (
                  <span className="ml-2 text-xs text-slate-400">(1차)</span>
                )}
              </div>
              <Link
                href={`/reports/${r.id}`}
                className="text-blue-600 hover:underline"
              >
                보기 →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}