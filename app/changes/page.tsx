import Link from 'next/link';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

type ChangeType =
  | 'NEW'
  | 'DEPARTED'
  | 'RANK_UP'
  | 'RANK_DOWN'
  | 'SCORE_UP'
  | 'SCORE_DOWN'
  | 'SECTOR_CHANGE';

interface ChangeRow {
  ticker: string;
  name: string | null;
  today_rank: number | null;
  yesterday_rank: number | null;
  rank_delta: number | null;
  today_score: number | null;
  yesterday_score: number | null;
  score_delta: number | null;
  today_sector: string | null;
  yesterday_sector: string | null;
  sector_changed: boolean;
  today_stage: string | null;
  yesterday_stage: string | null;
  change_type: ChangeType;
}

interface ChangeDump {
  generated_at?: string;
  today_date?: string | null;
  // v0.3-7 보정: 정식 필드는 previous_date / previous_path.
  // yesterday_date / yesterday_path 는 호환을 위해 함께 제공된다.
  previous_date?: string | null;
  yesterday_date?: string | null;
  today_path?: string | null;
  previous_path?: string | null;
  yesterday_path?: string | null;
  compare_label?: string | null;
  status: 'ok' | 'not_enough_snapshots' | 'parse_error' | 'error';
  message?: string;
  summary: {
    n_new_entries: number;
    n_departed: number;
    n_rank_up: number;
    n_rank_down: number;
    n_score_up: number;
    n_score_down: number;
    n_sector_changed: number;
    n_total_changes: number;
  };
  changes: ChangeRow[];
}

// previous_date 우선, 없으면 yesterday_date 사용 (호환).
function pickPreviousDate(d: ChangeDump): string | null {
  return d.previous_date ?? d.yesterday_date ?? null;
}
function pickPreviousPath(d: ChangeDump): string | null {
  return d.previous_path ?? d.yesterday_path ?? null;
}

type LoadResult =
  | { kind: 'ok'; data: ChangeDump }
  | { kind: 'missing' }
  | { kind: 'parse_error'; message: string };

async function loadChangeDump(): Promise<LoadResult> {
  const filePath = path.join(process.cwd(), 'logs', 'sidecar', 'change_dump_latest.json');
  let buf: string;
  try {
    buf = await readFile(filePath, 'utf-8');
  } catch {
    return { kind: 'missing' };
  }
  try {
    const data = JSON.parse(buf) as ChangeDump;
    return { kind: 'ok', data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { kind: 'parse_error', message };
  }
}

const TYPE_META: Record<ChangeType, { label: string; cls: string; icon: string }> = {
  NEW: { label: '신규 진입', cls: 'bg-emerald-100 text-emerald-800', icon: '🆕' },
  DEPARTED: { label: '이탈', cls: 'bg-slate-200 text-slate-700', icon: '🚪' },
  RANK_UP: { label: '순위 상승', cls: 'bg-sky-100 text-sky-800', icon: '⬆️' },
  RANK_DOWN: { label: '순위 하락', cls: 'bg-amber-100 text-amber-900', icon: '⬇️' },
  SCORE_UP: { label: '점수 상승', cls: 'bg-indigo-100 text-indigo-800', icon: '📈' },
  SCORE_DOWN: { label: '점수 하락', cls: 'bg-rose-100 text-rose-800', icon: '📉' },
  SECTOR_CHANGE: { label: '섹터 변화', cls: 'bg-violet-100 text-violet-800', icon: '🔁' },
};

function fmtRank(n: number | null | undefined): string {
  return n == null ? '-' : String(n);
}

function fmtScore(n: number | null | undefined): string {
  if (n == null) return '-';
  return Number(n).toFixed(1);
}

function fmtDelta(n: number | null | undefined, kind: 'rank' | 'score'): { text: string; cls: string } {
  if (n == null) return { text: '-', cls: 'text-slate-400' };
  if (n === 0) return { text: '0', cls: 'text-slate-500' };
  // rank: 음수 = 상승(좋음), 양수 = 하락(주의)
  // score: 양수 = 상승, 음수 = 하락
  const positiveIsGood = kind === 'score';
  const good = positiveIsGood ? n > 0 : n < 0;
  const arrow = n > 0 ? '▲' : '▼';
  const abs = Math.abs(n);
  const text = kind === 'rank' ? `${arrow}${abs}` : `${n > 0 ? '+' : '-'}${abs.toFixed(1)}`;
  return { text, cls: good ? 'text-emerald-700' : 'text-rose-700' };
}

export default async function ChangesPage() {
  const r = await loadChangeDump();

  // 화면 헤더(공통)
  // 큰 제목은 사용자 이해를 위해 "어제 대비 변화"를 유지하되,
  // 부제·메타에는 항상 "직전 스냅샷 2일치 비교"임을 명시한다.
  // daily 스냅샷이 연속 날짜로 존재한다는 보장이 없기 때문이다.
  const Header = ({ children }: { children?: React.ReactNode }) => (
    <header className="mb-4">
      <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
      <h1 className="mt-2 text-2xl font-bold text-slate-800">어제 대비 변화</h1>
      <p className="mt-1 text-sm text-slate-600">
        <strong>직전 스냅샷 2일치를 비교한 결과</strong>입니다 (daily 스냅샷이 연속 날짜라는 보장은 없습니다).
        관찰·복기 보조용이며 매매 권유가 아닙니다.
      </p>
      {children}
    </header>
  );

  if (r.kind === 'missing') {
    return (
      <main className="container mx-auto max-w-5xl p-6 sm:p-8">
        <Header />
        <div className="rounded-md border border-amber-300 bg-amber-50 p-6 text-amber-900">
          아직 비교 결과가 없습니다. 먼저 <code className="rounded bg-amber-100 px-1">scripts/compare_snapshots.py</code>를 실행해
          <code className="rounded bg-amber-100 px-1"> logs/sidecar/change_dump_latest.json</code>을 생성해 주세요.
        </div>
      </main>
    );
  }

  if (r.kind === 'parse_error') {
    return (
      <main className="container mx-auto max-w-5xl p-6 sm:p-8">
        <Header />
        <div className="rounded-md border border-red-300 bg-red-50 p-6 text-red-900">
          비교 결과 파일을 읽는 중 문제가 발생했습니다 — <strong>파일은 있으나 읽기 실패</strong>. compare_snapshots.py를 다시 실행해 주세요.
        </div>
      </main>
    );
  }

  const d = r.data;

  if (d.status === 'not_enough_snapshots' || d.status === 'parse_error' || d.status === 'error') {
    return (
      <main className="container mx-auto max-w-5xl p-6 sm:p-8">
        <Header />
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">아직 직전 스냅샷 대비 변화를 계산할 수 없습니다.</p>
          <p className="mt-1">{d.message ?? '사유 미확인'}</p>
          {d.today_date && (
            <p className="mt-1 text-xs text-amber-800">
              현재 보유 스냅샷 최신일: <strong>{d.today_date}</strong>
            </p>
          )}
        </div>
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p><strong>해결 방법:</strong></p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>오늘 <code className="rounded bg-slate-200 px-1">run_daily.bat</code> 또는 <code className="rounded bg-slate-200 px-1">run_sidecar.bat</code> 실행으로 첫 스냅샷 확보</li>
            <li>다음 영업일에 한 번 더 실행하면 직전 비교용 스냅샷이 모입니다</li>
            <li>이후 <code className="rounded bg-slate-200 px-1">python scripts/compare_snapshots.py</code> 재실행 → 본 화면 새로고침</li>
          </ul>
        </div>
        <p className="mt-4 text-[11px] text-slate-500">
          이 화면은 관찰·복기 보조용입니다. 어떤 표시도 매매 권유가 아니며, 투자 판단은 사용자 본인이 합니다.
        </p>
      </main>
    );
  }

  const { summary, changes } = d;
  const previousDate = pickPreviousDate(d);
  const previousPath = pickPreviousPath(d);
  const compareLabel = d.compare_label
    ?? (d.today_date && previousDate ? `${d.today_date} vs ${previousDate}` : (d.today_date ?? '-'));

  return (
    <main className="container mx-auto max-w-5xl p-6 sm:p-8">
      <Header>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>오늘 (최신 스냅샷) <strong className="text-slate-700">{d.today_date ?? '-'}</strong></span>
          <span>직전 스냅샷 <strong className="text-slate-700">{previousDate ?? '-'}</strong></span>
          {d.generated_at && <span>생성 {d.generated_at}</span>}
        </div>
      </Header>

      {/* v0.3-7 보정: 상단에 비교 기준을 강조해 보여준다.
          daily 스냅샷이 연속 날짜라는 보장이 없으므로
          사용자가 정확한 비교 기준을 즉시 인식할 수 있도록 한다. */}
      <div className="mb-4 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
        <p className="font-semibold">
          비교 기준: <span className="tabular-nums">{compareLabel}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-indigo-700">
          직전 스냅샷 2일치 비교입니다. 두 날짜가 반드시 연속(어제↔오늘)이라는 보장은 없으며,
          위의 두 날짜 사이의 변화만을 표시합니다.
        </p>
      </div>

      {/* 요약 카드 6칸 */}
      <section className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryNum label="신규 진입" value={summary.n_new_entries} cls="border-emerald-200 bg-emerald-50 text-emerald-900" icon="🆕" />
        <SummaryNum label="이탈" value={summary.n_departed} cls="border-slate-200 bg-slate-50 text-slate-800" icon="🚪" />
        <SummaryNum label="순위 상승" value={summary.n_rank_up} cls="border-sky-200 bg-sky-50 text-sky-900" icon="⬆️" />
        <SummaryNum label="순위 하락" value={summary.n_rank_down} cls="border-amber-200 bg-amber-50 text-amber-900" icon="⬇️" />
        <SummaryNum label="점수 상승" value={summary.n_score_up} cls="border-indigo-200 bg-indigo-50 text-indigo-900" icon="📈" />
        <SummaryNum label="점수 하락" value={summary.n_score_down} cls="border-rose-200 bg-rose-50 text-rose-900" icon="📉" />
      </section>

      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>총 변화 종목: <strong className="text-slate-700">{summary.n_total_changes}</strong></span>
        <span>섹터 변화: <strong className="text-slate-700">{summary.n_sector_changed}</strong></span>
        {d.today_path && <span className="text-[11px]">오늘 <code className="rounded bg-slate-100 px-1">{d.today_path}</code></span>}
        {previousPath && <span className="text-[11px]">직전 <code className="rounded bg-slate-100 px-1">{previousPath}</code></span>}
      </div>

      <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
        <strong>주의:</strong> 본 비교는 직전 스냅샷과 오늘 스냅샷 사이의 단순한 라벨/순위/점수 차이를 보여주는 보조 표시입니다.
        <strong> 매매 권유가 아니며</strong>, 최종 판단은 사용자 본인이 합니다.
        순위 △는 음수가 상승(개선)을 의미합니다.
      </div>

      {/* v0.3-8: 핵심 변화 종목 빠르게 보기 — 4 카드 (NEW / DEPARTED / RANK_UP / RANK_DOWN TOP10) */}
      <QuickTopCards changes={changes} />

      {/* 상세 목록 */}
      {changes.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
          어제 대비 변화가 잡힌 종목이 없습니다.
        </div>
      ) : (
        <ChangesTable rows={changes} />
      )}

      <p className="mt-4 text-[11px] text-slate-500">
        이 화면은 관찰·복기 보조용입니다. 어떤 표시도 매매 권유가 아니며, 최종 판단은 사용자 본인이 합니다.
      </p>
    </main>
  );
}

function SummaryNum({
  label, value, cls, icon,
}: { label: string; value: number; cls: string; icon: string }) {
  return (
    <div className={`rounded border p-2 ${cls}`}>
      <div className="text-[11px] opacity-80">{icon} {label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

const ROW_DEFAULT_LIMIT = 50;

function ChangesTable({ rows }: { rows: ChangeRow[] }) {
  const head = rows.slice(0, ROW_DEFAULT_LIMIT);
  const rest = rows.slice(ROW_DEFAULT_LIMIT);
  return (
    <>
      <div className="overflow-x-auto rounded-md border border-slate-200 shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-2 py-2 text-left">종목</th>
              <th className="px-2 py-2 text-center">오늘 순위</th>
              <th className="px-2 py-2 text-center">직전 순위</th>
              <th className="px-2 py-2 text-center">순위 △</th>
              <th className="px-2 py-2 text-right">오늘 점수</th>
              <th className="px-2 py-2 text-right">직전 점수</th>
              <th className="px-2 py-2 text-right">점수 △</th>
              <th className="px-2 py-2 text-left">섹터</th>
              <th className="px-2 py-2 text-left">변화 유형</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {head.map((r) => <RowItem key={r.ticker} r={r} />)}
          </tbody>
        </table>
      </div>
      {rest.length > 0 && (
        <details className="mt-2">
          <summary className="inline-flex cursor-pointer items-center rounded bg-slate-100 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200">
            나머지 {rest.length}개 더 보기
          </summary>
          <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <tbody className="divide-y divide-slate-100 bg-white">
                {rest.map((r) => <RowItem key={r.ticker} r={r} />)}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

function RowItem({ r }: { r: ChangeRow }) {
  const meta = TYPE_META[r.change_type];
  const rankDelta = fmtDelta(r.rank_delta, 'rank');
  const scoreDelta = fmtDelta(r.score_delta, 'score');
  const sectorChangedBadge = r.sector_changed
    ? <span className="ml-1 inline-flex rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-800">변화</span>
    : null;
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-2 py-1.5">
        <Link href={`/stocks/${r.ticker}`} className="font-medium text-slate-800 hover:underline">
          {r.name ?? r.ticker}
        </Link>
        <span className="ml-1 text-[10px] text-slate-400">{r.ticker}</span>
      </td>
      <td className="px-2 py-1.5 text-center tabular-nums">{fmtRank(r.today_rank)}</td>
      <td className="px-2 py-1.5 text-center tabular-nums">{fmtRank(r.yesterday_rank)}</td>
      <td className={`px-2 py-1.5 text-center tabular-nums font-medium ${rankDelta.cls}`}>{rankDelta.text}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{fmtScore(r.today_score)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{fmtScore(r.yesterday_score)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${scoreDelta.cls}`}>{scoreDelta.text}</td>
      <td className="px-2 py-1.5">
        <span className="text-slate-700">{r.today_sector ?? '-'}</span>
        {r.sector_changed && r.yesterday_sector && r.yesterday_sector !== r.today_sector && (
          <span className="ml-1 text-[10px] text-slate-400">(직전 {r.yesterday_sector})</span>
        )}
        {sectorChangedBadge}
      </td>
      <td className="px-2 py-1.5">
        <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
          {meta.icon} {meta.label}
        </span>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// v0.3-8: "핵심 변화 종목 빠르게 보기" — NEW / DEPARTED / RANK_UP / RANK_DOWN TOP10
// 표를 끝까지 스크롤하지 않아도 핵심 종목을 한눈에 보기 위한 4 카드.
// compare_snapshots.py 결과(change_dump_latest.json)를 다시 계산하지 않고
// 클라이언트에서 정렬/필터링만 한다. JSON 구조 변경 0건.
// ─────────────────────────────────────────────────────────────────────────

const QUICK_LIMIT = 10;

function pickTop(
  rows: ChangeRow[],
  filter: (r: ChangeRow) => boolean,
  sorter: (a: ChangeRow, b: ChangeRow) => number,
  limit: number = QUICK_LIMIT,
): ChangeRow[] {
  return rows.filter(filter).sort(sorter).slice(0, limit);
}

function QuickTopCards({ changes }: { changes: ChangeRow[] }) {
  // 1) NEW — today_rank 오름차순
  const newRows = pickTop(
    changes,
    (r) => r.change_type === 'NEW',
    (a, b) => (a.today_rank ?? 9999) - (b.today_rank ?? 9999),
  );

  // 2) DEPARTED — previous_rank(=yesterday_rank) 오름차순
  const departedRows = pickTop(
    changes,
    (r) => r.change_type === 'DEPARTED',
    (a, b) => (a.yesterday_rank ?? 9999) - (b.yesterday_rank ?? 9999),
  );

  // 3) RANK_UP — rank_delta 가 음수일수록 더 큰 개선 (예: -120, -80, -30)
  const rankUpRows = pickTop(
    changes,
    (r) => typeof r.rank_delta === 'number' && (r.rank_delta as number) < 0,
    (a, b) => (a.rank_delta as number) - (b.rank_delta as number),
  );

  // 4) RANK_DOWN — rank_delta 가 양수일수록 더 큰 하락 (예: +120, +80, +30)
  const rankDownRows = pickTop(
    changes,
    (r) => typeof r.rank_delta === 'number' && (r.rank_delta as number) > 0,
    (a, b) => (b.rank_delta as number) - (a.rank_delta as number),
  );

  return (
    <section className="mb-5">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">핵심 변화 종목 빠르게 보기</h2>
      <p className="mb-3 text-[11px] text-slate-500">
        표를 끝까지 보지 않아도 직전 스냅샷 대비 핵심 변화 종목을 빠르게 확인할 수 있도록 4 카드로 추렸습니다.
        모든 카드는 <strong>관찰 후보</strong>이며 매매 권유가 아닙니다.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <QuickCard
          title="신규 진입 TOP10"
          icon="🆕"
          headCls="border-emerald-200 bg-emerald-50 text-emerald-900"
          rows={newRows}
          variant="NEW"
          note="오늘 후보에 새로 들어온 종목입니다. 관찰 후보이며 매수 권유가 아닙니다."
        />
        <QuickCard
          title="이탈 TOP10"
          icon="🚪"
          headCls="border-slate-300 bg-slate-50 text-slate-800"
          rows={departedRows}
          variant="DEPARTED"
          note="직전 스냅샷에는 있었지만 오늘 후보에서는 빠진 종목입니다."
        />
        <QuickCard
          title="순위 개선 TOP10"
          icon="⬆"
          headCls="border-sky-200 bg-sky-50 text-sky-900"
          rows={rankUpRows}
          variant="RANK_UP"
          note="가격 상승이 아니라 스캐너 내 후보 순위 개선입니다. 매수 권유가 아닙니다."
        />
        <QuickCard
          title="순위 하락 TOP10"
          icon="⬇"
          headCls="border-amber-200 bg-amber-50 text-amber-900"
          rows={rankDownRows}
          variant="RANK_DOWN"
          note="가격 하락이 아니라 스캐너 내 후보 순위가 밀린 것입니다. 매도 권유가 아니라 복기 보조 정보입니다."
        />
      </div>
    </section>
  );
}

function QuickCard({
  title, icon, headCls, rows, variant, note,
}: {
  title: string;
  icon: string;
  headCls: string;
  rows: ChangeRow[];
  variant: 'NEW' | 'DEPARTED' | 'RANK_UP' | 'RANK_DOWN';
  note: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white shadow-sm">
      <div className={`flex items-baseline justify-between gap-2 rounded-t-md border-b px-3 py-2 ${headCls}`}>
        <span className="text-sm font-semibold">{icon} {title}</span>
        <span className="text-[11px] opacity-80">{rows.length}개</span>
      </div>
      <p className="px-3 pb-1 pt-2 text-[11px] text-slate-500">{note}</p>
      {rows.length === 0 ? (
        <div className="px-3 pb-3 pt-1 text-[12px] text-slate-500">해당 종목 없음</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <QuickRow key={r.ticker} idx={i + 1} r={r} variant={variant} />
          ))}
        </ul>
      )}
    </div>
  );
}

function QuickRow({
  idx, r, variant,
}: { idx: number; r: ChangeRow; variant: 'NEW' | 'DEPARTED' | 'RANK_UP' | 'RANK_DOWN' }) {
  const rankDelta = fmtDelta(r.rank_delta, 'rank');
  const scoreDelta = fmtDelta(r.score_delta, 'score');

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5 text-[12px] hover:bg-slate-50">
      <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-slate-400">{idx}</span>
      <Link href={`/stocks/${r.ticker}`} className="font-medium text-slate-800 hover:underline">
        {r.name ?? r.ticker}
      </Link>
      <span className="text-[10px] text-slate-400">{r.ticker}</span>

      {variant === 'NEW' && (
        <span className="ml-auto inline-flex flex-wrap items-baseline gap-x-2 text-[11px] tabular-nums text-slate-600">
          <span>오늘 순위 <strong className="text-slate-800">{fmtRank(r.today_rank)}</strong></span>
          {r.today_score != null && <span>점수 <strong className="text-slate-800">{fmtScore(r.today_score)}</strong></span>}
          {r.today_sector && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">섹터 {r.today_sector}</span>}
        </span>
      )}

      {variant === 'DEPARTED' && (
        <span className="ml-auto inline-flex flex-wrap items-baseline gap-x-2 text-[11px] tabular-nums text-slate-600">
          <span>직전 순위 <strong className="text-slate-800">{fmtRank(r.yesterday_rank)}</strong></span>
          {r.yesterday_score != null && <span>직전 점수 <strong className="text-slate-800">{fmtScore(r.yesterday_score)}</strong></span>}
          {(r.today_sector ?? r.yesterday_sector) && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
              섹터 {r.today_sector ?? r.yesterday_sector}
            </span>
          )}
        </span>
      )}

      {(variant === 'RANK_UP' || variant === 'RANK_DOWN') && (
        <span className="ml-auto inline-flex flex-wrap items-baseline gap-x-2 text-[11px] tabular-nums text-slate-600">
          <span>오늘 <strong className="text-slate-800">{fmtRank(r.today_rank)}</strong></span>
          <span>직전 <strong className="text-slate-800">{fmtRank(r.yesterday_rank)}</strong></span>
          <span className={`font-medium ${rankDelta.cls}`}>순위 △ {rankDelta.text}</span>
          {r.score_delta != null && (
            <span className={`font-medium ${scoreDelta.cls}`}>점수 △ {scoreDelta.text}</span>
          )}
        </span>
      )}
    </li>
  );
}
