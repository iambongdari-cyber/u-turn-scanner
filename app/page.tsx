import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function Home() {
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