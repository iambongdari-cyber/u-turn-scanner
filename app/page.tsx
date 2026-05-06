import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// 매번 최신 데이터를 받기 위해 캐싱 비활성
export const dynamic = 'force-dynamic';

export default async function Home() {
  // 가장 최근 daily 리포트 1개의 id를 찾는다
  const { data, error } = await supabase
    .from('reports')
    .select('id')
    .eq('report_type', 'daily')
    .order('base_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-800 mb-2">U턴 스캐너</h1>
          <p className="text-red-600">DB 조회 오류: {error.message}</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-slate-800 mb-2">U턴 스캐너</h1>
          <p className="text-slate-600">
            아직 생성된 리포트가 없습니다.<br />
            <code className="text-sm bg-slate-100 px-1 rounded">scripts/run_scan.py</code>
            를 먼저 실행해주세요.
          </p>
        </div>
      </main>
    );
  }

  redirect(`/reports/${data.id}`);
}