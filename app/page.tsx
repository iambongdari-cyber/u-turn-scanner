import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import SearchForm from './_components/SearchForm';

export const dynamic = 'force-dynamic';

export default async function Home() {
  // 가장 최근 일일 리포트 1건
  const { data: latestDaily } = await supabase
    .from('reports')
    .select('id, base_date')
    .eq('report_type', 'daily')
    .order('base_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <main className="container mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">U턴 스캐너</h1>
        <p className="mt-1 text-sm text-slate-600">
          국내주식 U턴 종목 자동 스캐너 · 분석 보조 도구
        </p>
      </header>

      <SearchForm defaultDate={latestDaily?.base_date} />

      <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
        {latestDaily ? (
          <Link
            href={`/reports/${latestDaily.id}`}
            className="text-blue-600 hover:underline"
          >
            ▶ 가장 최근 일일 리포트 ({latestDaily.base_date}) 바로 보기
          </Link>
        ) : (
          <span className="text-slate-500">아직 일일 리포트가 없습니다.</span>
        )}
        <Link href="/history" className="text-blue-600 hover:underline">
          📅 과거 리포트 전체 보기
        </Link>
      </div>
    </main>
  );
}