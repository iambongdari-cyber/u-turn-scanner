import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ type?: string; date?: string }>;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { type, date } = await searchParams;

  // 입력값 검증
  const reportType = type === 'weekly' ? 'weekly' : 'daily';
  const requestedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date().toISOString().split('T')[0];

  // 요청한 날짜 이하의 가장 최근 리포트
  const { data, error } = await supabase
    .from('reports')
    .select('id, base_date')
    .eq('report_type', reportType)
    .lte('base_date', requestedDate)
    .order('base_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-red-600">DB 조회 오류: {error.message}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="container mx-auto max-w-2xl p-8">
        <h1 className="mb-2 text-xl font-bold text-slate-800">리포트 없음</h1>
        <p className="text-slate-600">
          {requestedDate} 이전의 {reportType === 'daily' ? '일일' : '주간'} 리포트가
          데이터베이스에 없습니다.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          <a href="/" className="text-blue-600 hover:underline">메인으로 돌아가기</a>
        </p>
      </main>
    );
  }

  // 매칭된 리포트로 이동. 요청 날짜를 함께 전달해서 안내 문구 표시 가능하게.
  redirect(`/reports/${data.id}?requested=${requestedDate}`);
}