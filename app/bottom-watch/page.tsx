import Link from 'next/link';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

interface BottomCandidate {
  ticker: string;
  name: string;
  market?: string | null;
  sector?: string | null;
  stage: string | null;
  close: number | null;
  ma60: number | null;
  disparity_pct: number | null;
  golden_days_ago: number | null;
  days_below_ma60_60d: number | null;
  value_ratio: number | null;
  avg_value_20_eok: number | null;
  checks?: Record<string, boolean>;
  evidence?: string[];
  final_grade_from_run_scan?: string | null;
  news_critical?: boolean;
}

interface DumpData {
  generated_at?: string;
  report_type?: string;
  base_date?: string | null;
  market?: {
    kospi_above_ma60?: boolean;
    kosdaq_above_ma60?: boolean;
    kospi_20d_return?: number | null;
    kosdaq_20d_return?: number | null;
    flow?: string;
  };
  candidates_bottom?: BottomCandidate[];
  summary?: {
    n_analyzed?: number;
    n_candidates_bottom?: number;
    stage_counts?: Record<string, number>;
  };
}

type LoadResult =
  | { status: 'ok'; data: DumpData }
  | { status: 'missing' }
  | { status: 'parse_error'; message: string };

async function loadDump(): Promise<LoadResult> {
  const filePath = path.join(process.cwd(), 'logs', 'sidecar', 'scan_dump_latest.json');
  let buf: string;
  try {
    buf = await readFile(filePath, 'utf-8');
  } catch {
    return { status: 'missing' };
  }
  try {
    const data = JSON.parse(buf) as DumpData;
    return { status: 'ok', data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { status: 'parse_error', message };
  }
}

function gradeLabel(g: string | null | undefined): string {
  if (g === 'A' || g === 'B') return '기회 후보';
  if (g === 'CHASE_RISK') return '추격 위험';
  if (g === 'WATCH' || g === 'EXCLUDE') return '조건 부족';
  return '관찰 보조';
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '-';
  return Math.round(Number(n)).toLocaleString();
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return '-';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

const STAGES: string[] = ['바닥 관찰', 'U턴 시도', 'U턴 확인', '추세전환 후보'];

const STAGE_DESC: Record<string, string> = {
  '바닥 관찰': '종가가 60일선 위에 있고 U턴 검증(최근 60일 중 60일선 아래 ≥10일)을 충족하지만, 아직 골든크로스가 감지되지 않은 종목입니다.',
  'U턴 시도': '최근 0~1거래일 사이에 10일선이 60일선을 상향 돌파한 종목입니다. U턴 시도 직후 확인 필요.',
  'U턴 확인': '2~5거래일 전 골든크로스가 발생해 U턴이 자리잡아 가는 종목입니다.',
  '추세전환 후보': '6거래일 이상 전에 골든크로스가 발생해 추세가 자리잡힌 종목입니다.',
};

const STAGE_ICON: Record<string, string> = {
  '바닥 관찰': '🌱',
  'U턴 시도': '🔄',
  'U턴 확인': '✅',
  '추세전환 후보': '📈',
};

export default async function BottomWatchPage() {
  const r = await loadDump();

  if (r.status === 'missing') {
    return (
      <main className="container mx-auto max-w-4xl p-6 sm:p-8">
        <header className="mb-6">
          <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-800">바닥 U턴 후보</h1>
          <p className="mt-1 text-sm text-slate-600">
            바닥권에서 U턴 가능성을 보이는 종목을 단계별로 관찰합니다. 관찰·복기 보조용이며 매매 권유가 아닙니다.
          </p>
        </header>
        <div className="rounded-md border border-amber-300 bg-amber-50 p-6 text-amber-900">
          아직 바닥 U턴 후보 데이터가 없습니다. 먼저 <code className="rounded bg-amber-100 px-1">scripts/scan_dump.py</code>를 실행해 사이드카 JSON을 생성해 주세요.
        </div>
      </main>
    );
  }

  if (r.status === 'parse_error') {
    return (
      <main className="container mx-auto max-w-4xl p-6 sm:p-8">
        <header className="mb-6">
          <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-800">바닥 U턴 후보</h1>
        </header>
        <div className="rounded-md border border-red-300 bg-red-50 p-6 text-red-900">
          바닥 U턴 후보 데이터를 읽는 중 문제가 발생했습니다. <code className="rounded bg-red-100 px-1">scan_dump_latest.json</code> 파일을 다시 생성해 주세요.
        </div>
      </main>
    );
  }

  const d = r.data;
  const candidates = (d.candidates_bottom ?? []).filter((c): c is BottomCandidate => !!c);
  const counts = d.summary?.stage_counts ?? {};

  const groups = new Map<string, BottomCandidate[]>();
  for (const s of STAGES) groups.set(s, []);
  for (const c of candidates) {
    if (c.stage && groups.has(c.stage)) groups.get(c.stage)!.push(c);
  }

  return (
    <main className="container mx-auto max-w-4xl p-6 sm:p-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">바닥 U턴 후보</h1>
        <p className="mt-1 text-sm text-slate-600">
          바닥권에서 U턴 가능성을 보이는 종목을 단계별로 관찰합니다. 관찰·복기 보조용이며 매매 권유가 아닙니다.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {d.base_date && <span>기준일 {d.base_date}</span>}
          {d.generated_at && <span>생성 {d.generated_at}</span>}
          {d.market?.flow && (
            <span className="inline-flex items-center gap-1">
              시장 흐름
              <span className={`rounded px-2 py-0.5 ${
                d.market.flow === '강세 흐름' ? 'bg-green-100 text-green-800' :
                d.market.flow === '약세 흐름' ? 'bg-red-100 text-red-800' :
                                                'bg-slate-200 text-slate-700'
              }`}>{d.market.flow}</span>
            </span>
          )}
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <SummaryCard label="전체 바닥 후보" value={d.summary?.n_candidates_bottom ?? candidates.length} />
        {STAGES.map((s) => (
          <SummaryCard key={s} label={s} value={counts[s] ?? (groups.get(s)?.length ?? 0)} />
        ))}
      </section>

      <p className="mb-4 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
        기본 노출은 거래대금 회복과 U턴 근거가 뚜렷한 종목을 우선으로 보여줍니다. 각 단계별 최대 10개이며, 나머지는 "더 보기"로 펼치세요.
      </p>

      {STAGES.map((s) => (
        <StageSection
          key={s}
          title={`${STAGE_ICON[s] ?? ''} ${s}`}
          items={groups.get(s) ?? []}
          desc={STAGE_DESC[s] ?? ''}
        />
      ))}

      <div className="mt-6 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p>
          본 화면은 "바닥에서 많이 빠진 종목"을 추천하는 화면이 아닙니다.
          <strong> 바닥(U턴 검증) + 거래대금 회복 + 추세 전환 + 근거</strong>가 함께 나타나는 종목을 단계별로 정리한 <strong>관찰·복기 보조</strong> 화면입니다.
        </p>
        <p className="mt-1 text-slate-500">
          어떤 표시도 매매 권유가 아니며, 최종 판단은 사용자 본인이 합니다. 뉴스 위험은 별도 <code className="rounded bg-slate-200 px-1">확인 필요</code> 표시로 안내합니다.
        </p>
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

const STAGE_DEFAULT_LIMIT = 10;

function StageSection({
  title, items, desc,
}: { title: string; items: BottomCandidate[]; desc: string }) {
  const head = items.slice(0, STAGE_DEFAULT_LIMIT);
  const rest = items.slice(STAGE_DEFAULT_LIMIT);
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-base font-semibold text-slate-800">
        {title} <span className="ml-2 text-xs text-slate-500">{items.length}개</span>
      </h2>
      {desc && <p className="mb-2 text-xs text-slate-500">{desc}</p>}
      {items.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          해당 단계의 종목이 없습니다.
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {head.map((c) => (
              <CandidateCard key={c.ticker} c={c} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="mt-2">
              <summary className="inline-flex cursor-pointer items-center rounded bg-slate-100 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200">
                나머지 {rest.length}개 더 보기
              </summary>
              <ul className="mt-2 space-y-2">
                {rest.map((c) => (
                  <CandidateCard key={c.ticker} c={c} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function CandidateCard({ c }: { c: BottomCandidate }) {
  const gLab = gradeLabel(c.final_grade_from_run_scan);
  return (
    <li className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/stocks/${c.ticker}`} className="font-medium text-slate-800 hover:underline">
          {c.name}
          <span className="ml-2 text-xs text-slate-400">{c.ticker}</span>
        </Link>
        <div className="flex flex-wrap gap-1">
          {c.stage && (
            <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {c.stage}
            </span>
          )}
          <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {gLab}
          </span>
          {c.news_critical && (
            <span className="inline-flex rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
              뉴스 위험 확인 필요
            </span>
          )}
        </div>
      </div>

      {c.sector && (
        <div className="mt-1 text-xs text-slate-500">섹터: {c.sector}</div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums text-slate-600 sm:grid-cols-3">
        <div>종가 <span className="text-slate-800">{fmt(c.close)}</span></div>
        <div>60일선 <span className="text-slate-800">{fmt(c.ma60)}</span></div>
        <div>이격 <span className="text-slate-800">{fmtPct(c.disparity_pct)}</span></div>
        <div>60일 중 아래 <span className="text-slate-800">{c.days_below_ma60_60d ?? '-'}일</span></div>
        <div>
          거래대금 회복{' '}
          <span className="text-slate-800">
            {c.value_ratio != null ? `${Number(c.value_ratio).toFixed(1)}배` : '-'}
          </span>
        </div>
        <div>
          20일 평균 거래대금{' '}
          <span className="text-slate-800">
            {c.avg_value_20_eok != null ? `${Number(c.avg_value_20_eok).toFixed(1)}억` : '-'}
          </span>
        </div>
      </div>

      {c.evidence && c.evidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {c.evidence.map((ev, i) => (
            <span
              key={i}
              className="inline-flex rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800"
            >
              {ev}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 text-right">
        <Link href={`/stocks/${c.ticker}`} className="text-xs text-blue-600 hover:underline">
          종목 상세 →
        </Link>
      </div>
    </li>
  );
}
