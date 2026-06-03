import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import {
  loadSidecarBundle,
  stageBadgeClass,
  classificationBadgeClass,
  buildJournalDraft,
} from '@/app/_lib/sidecar';

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

function stagePhraseFallback(daysAgo: number | null | undefined): string {
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
  const [scansRes, sidecar] = await Promise.all([
    tickers.length > 0
      ? supabase
          .from('scan_results')
          .select(`ticker, close, score, final_grade, golden_days_ago, disparity_pct,
                   buy1_price, buy2_price, stop_loss, one_line,
                   stocks ( name )`)
          .in('ticker', tickers)
          .order('ticker', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    loadSidecarBundle(),
  ]);

  const scanByTicker = new Map<string, ScanContext>();
  for (const s of ((scansRes.data ?? []) as unknown as ScanContext[])) {
    if (!scanByTicker.has(s.ticker)) scanByTicker.set(s.ticker, s);
  }

  const sidecarStateNotice =
    (sidecar.scanMissing && sidecar.sectorMissing) ? (
      <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
        사이드카 분석 데이터가 아직 없습니다. <code className="rounded bg-slate-200 px-1">scripts/scan_dump.py</code> · <code className="rounded bg-slate-200 px-1">scripts/sector_dump.py</code> 실행 후 일부 라벨이 보강됩니다.
      </div>
    ) : (sidecar.scanError || sidecar.sectorError) ? (
      <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
        사이드카 일부 데이터를 읽지 못했습니다. 일지 초안은 기존 데이터로 정상 표시됩니다.
      </div>
    ) : null;

  return (
    <main className="container mx-auto max-w-3xl p-6 sm:p-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">매매일지 초안</h1>
        <p className="mt-1 text-sm text-slate-600">
          관심종목 메모와 스캔 컨텍스트를 묶어 보여줍니다. 관찰·복기 보조용 초안이며 매매 권유가 아닙니다.
        </p>
      </header>

      {sidecarStateNotice}

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
            const sc = sidecar.contexts.get(n.ticker);
            const stage = sc?.stage ?? stagePhraseFallback(ctx?.golden_days_ago ?? null);
            const gLabel = sc?.classification ?? gradeLabel(ctx?.final_grade ?? null);
            const evidence = sc?.evidence ?? [];
            const cautions = sc?.chase_risk_reasons ?? [];
            const newsCritical = sc?.news_critical ?? false;

            // v0.3-3: 일지 초안 4섹션 보강 — 왜 떴는지 / 조심할 점 / 내일 다시 볼 조건 / 추격하지 말아야 할 이유
            const draft = buildJournalDraft({
              stage: sc?.stage ?? null,
              classification: sc?.classification ?? null,
              sector: sc?.sector ?? null,
              evidence,
              chase_risk_reasons: cautions,
              news_critical: newsCritical,
              disparity_pct: ctx?.disparity_pct ?? null,
              golden_days_ago: ctx?.golden_days_ago ?? null,
            });

            return (
              <li key={`${n.report_id}-${n.ticker}`} className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <Link href={`/stocks/${n.ticker}`} className="text-lg font-semibold text-slate-800 hover:underline">
                    {ctx?.stocks?.name ?? n.ticker}
                  </Link>
                  <span className="text-xs text-slate-500">{n.ticker}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  <span className={`inline-flex rounded px-2 py-0.5 ${stageBadgeClass(stage)}`}>
                    단계: {stage}
                  </span>
                  <span className={`inline-flex rounded px-2 py-0.5 ${classificationBadgeClass(gLabel)}`}>
                    분류: {gLabel}
                  </span>
                  {sc?.sector && (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">섹터: {sc.sector}</span>
                  )}
                  {n.interest_level && (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800">관심도 {n.interest_level}</span>
                  )}
                  {n.my_decision && (
                    <span className="rounded bg-purple-100 px-2 py-0.5 text-purple-800">내 판단 {n.my_decision}</span>
                  )}
                  {newsCritical && (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">뉴스 위험 확인 필요</span>
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

                <div className="mt-3 rounded border border-indigo-200 bg-indigo-50 p-3">
                  <p className="mb-1 text-xs font-semibold text-indigo-800">일지 초안 — 관찰·복기 보조</p>
                  <p className="mb-2 text-[11px] text-indigo-700">
                    이 박스는 사이드카 분석에서 <strong>자동으로 채워지는 초안</strong>입니다. 사용자 본인의 판단·근거는 아래 <strong>자유 메모</strong>에 따로 적어 주세요.
                  </p>
                  <div className="space-y-2 text-xs text-slate-700">
                    {/* ① 왜 떴는지 */}
                    <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
                      <p className="mb-1 text-[11px] font-semibold text-emerald-800">① 왜 떴는지</p>
                      <p className="text-slate-700">{draft.why}</p>
                      {evidence.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {evidence.map((ev, i) => (
                            <span key={i} className="inline-flex rounded bg-white px-2 py-0.5 text-[10px] text-emerald-800 ring-1 ring-emerald-200">
                              {ev}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ② 조심할 점 */}
                    <div className="rounded border border-amber-200 bg-amber-50 p-2">
                      <p className="mb-1 text-[11px] font-semibold text-amber-800">② 조심할 점</p>
                      <p className="text-slate-700">{draft.caution}</p>
                      {cautions.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {cautions.map((c, i) => (
                            <span key={i} className="inline-flex rounded bg-white px-2 py-0.5 text-[10px] text-orange-800 ring-1 ring-orange-200">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ③ 내일 다시 볼 조건 */}
                    <div className="rounded border border-sky-200 bg-sky-50 p-2">
                      <p className="mb-1 text-[11px] font-semibold text-sky-800">③ 내일 다시 볼 조건</p>
                      <p className="text-slate-700">{draft.next}</p>
                    </div>

                    {/* ④ 추격하지 말아야 할 이유 — 해당 시만 */}
                    {draft.noChase && (
                      <div className="rounded border border-orange-300 bg-orange-50 p-2 ring-1 ring-orange-200">
                        <p className="mb-1 text-[11px] font-semibold text-orange-900">⚠️ ④ 추격하지 말아야 할 이유</p>
                        <p className="text-slate-700">{draft.noChase}</p>
                        <p className="mt-1 text-[10px] text-orange-700">
                          이 표시는 신규 진입 위험을 경고하는 라벨이며, <strong>매수/매도 지시가 아닙니다</strong>.
                        </p>
                      </div>
                    )}
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
