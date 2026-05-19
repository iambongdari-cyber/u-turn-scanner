import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AlertActions from './AlertActions';

export const dynamic = 'force-dynamic';

interface AlertRow {
  id: number;
  alert_type: string;
  ticker: string | null;
  title: string;
  detail: string | null;
  severity: string;
  base_date: string | null;
  is_read: boolean;
  created_at: string;
}

export default async function AlertsPage() {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    return (
      <main className="container mx-auto max-w-5xl p-8">
        <p className="text-red-600">DB 조회 오류: {error.message}</p>
      </main>
    );
  }

  const rows = (data ?? []) as AlertRow[];
  const unread = rows.filter((r) => !r.is_read);

  return (
    <main className="container mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-slate-800">알림</h1>
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← 홈
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          전체 {rows.length}건 / 안 읽음 {unread.length}건
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-8 text-center text-slate-600">
          알림이 없습니다.
          <br />
          <span className="text-sm text-slate-500">
            run_daily.bat 실행 시 자동으로 변동사항이 기록됩니다.
          </span>
        </div>
      ) : (
        <>
          <AlertActions hasUnread={unread.length > 0} />
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className={`rounded-md border p-3 ${
                  r.is_read
                    ? 'border-slate-200 bg-slate-50 opacity-70'
                    : severityClass(r.severity)
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={r.severity} />
                      <TypeBadge type={r.alert_type} />
                      <span className="text-xs text-slate-500">
                        {formatTime(r.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      {r.ticker ? (
                        <Link
                          href={`/stocks/${r.ticker}`}
                          className="hover:underline"
                        >
                          {r.title}
                        </Link>
                      ) : (
                        r.title
                      )}
                    </p>
                    {r.detail && (
                      <p className="mt-1 text-xs text-slate-600">{r.detail}</p>
                    )}
                    {r.base_date && (
                      <p className="mt-1 text-[10px] text-slate-400">
                        기준일 {r.base_date}
                      </p>
                    )}
                  </div>
                  {!r.is_read && (
                    <AlertActions singleId={r.id} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function severityClass(sev: string): string {
  if (sev === 'CRITICAL') return 'border-red-300 bg-red-50';
  if (sev === 'WARN') return 'border-yellow-300 bg-yellow-50';
  return 'border-blue-200 bg-blue-50';
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    CRITICAL: { label: '위험', cls: 'bg-red-200 text-red-800' },
    WARN: { label: '주의', cls: 'bg-yellow-200 text-yellow-800' },
    INFO: { label: '정보', cls: 'bg-blue-200 text-blue-800' },
  };
  const m = map[severity] ?? { label: severity, cls: 'bg-slate-200 text-slate-700' };
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    NEW_CRITICAL: '새 위험 공시',
    NEW_TOP: 'TOP 신규',
    INTEREST_CRITICAL: '관심종목 위험',
  };
  return (
    <span className="text-[10px] text-slate-500">{map[type] ?? type}</span>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
