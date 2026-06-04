"""
v0.3-7 compare_snapshots.py - "Previous snapshot vs today" diff.

READ-ONLY. No DB writes. No analysis logic change. WARN-only.

Note on terminology:
  The web page calls this "yesterday vs today" for user familiarity,
  but daily snapshots are not guaranteed to exist on consecutive dates.
  This script always compares "latest" with "the one before latest"
  (= previous), regardless of how many days apart they are.

Input:
  logs/sidecar/daily/scan_dump_<YYYY-MM-DD>.json  (created by v0.3-6)
  fallback: logs/sidecar/daily_snapshots/

Output:
  logs/sidecar/change_dump_latest.json
  fields:
    today_date / previous_date  (primary v0.3-7 fields)
    yesterday_date / yesterday_path  (kept for backward compat)
    compare_label  (e.g. "2026-06-04 vs 2026-06-02")
    status  ok | not_enough_snapshots | parse_error | error
    summary { n_new_entries, n_departed, n_rank_up, n_rank_down,
              n_score_up, n_score_down, n_sector_changed, n_total_changes }
    changes [ ... per-ticker rows ... ]
"""
from __future__ import annotations

import json
import re
import sys
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
SIDECAR_DIR = ROOT / "logs" / "sidecar"
DAILY_DIR_PRIMARY = SIDECAR_DIR / "daily"
DAILY_DIR_ALT = SIDECAR_DIR / "daily_snapshots"
OUTPUT_PATH = SIDECAR_DIR / "change_dump_latest.json"

DATE_RE = re.compile(r"scan_dump_(\d{4}-\d{2}-\d{2})\.json$")


def now_iso_kst() -> str:
    return datetime.now(tz=KST).strftime("%Y-%m-%d %H:%M KST")


def discover_snapshots() -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for d in (DAILY_DIR_PRIMARY, DAILY_DIR_ALT):
        if not d.exists():
            continue
        for p in d.glob("scan_dump_*.json"):
            m = DATE_RE.search(p.name)
            if m:
                found.append((m.group(1), p))
    seen: dict[str, Path] = {}
    for date_str, p in found:
        if date_str not in seen:
            seen[date_str] = p
        else:
            try:
                if DAILY_DIR_PRIMARY in p.parents:
                    seen[date_str] = p
            except Exception:
                pass
    return sorted(seen.items(), key=lambda kv: kv[0], reverse=True)


def load_json(p: Path) -> dict[str, Any] | None:
    try:
        with open(p, "r", encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict):
            return d
    except Exception:
        pass
    return None


def build_context(scan: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not scan:
        return out
    cb = scan.get("candidates_bottom") or []
    for i, item in enumerate(cb):
        if not isinstance(item, dict):
            continue
        t = item.get("ticker")
        if not t:
            continue
        out.setdefault(t, {})
        out[t]["rank"] = i + 1
        out[t]["name"] = item.get("name") or out[t].get("name")
        out[t]["sector"] = item.get("sector") or out[t].get("sector")
        out[t]["stage"] = item.get("stage") or out[t].get("stage")
        out[t]["final_grade"] = item.get("final_grade_from_run_scan") or out[t].get("final_grade")
    asl = scan.get("all_stage_labels") or []
    for item in asl:
        if not isinstance(item, dict):
            continue
        t = item.get("ticker")
        if not t:
            continue
        prev = out.setdefault(t, {})
        prev.setdefault("rank", None)
        prev["name"] = prev.get("name") or item.get("name")
        prev["sector"] = prev.get("sector") or item.get("sector")
        prev["stage"] = prev.get("stage") or item.get("stage")
        prev["final_grade"] = prev.get("final_grade") or item.get("final_grade_from_run_scan")
        sc = item.get("score_from_run_scan")
        if isinstance(sc, (int, float)):
            prev["score"] = float(sc)
        prev.setdefault("score", None)
    return out


def diff(today_ctx: dict, previous_ctx: dict) -> list[dict]:
    rows: list[dict] = []
    SCORE_THRESHOLD = 0.5
    all_tickers = set(today_ctx.keys()) | set(previous_ctx.keys())

    for t in all_tickers:
        tc = today_ctx.get(t)
        pc = previous_ctx.get(t)
        today_rank = (tc or {}).get("rank")
        previous_rank = (pc or {}).get("rank")
        today_score = (tc or {}).get("score")
        previous_score = (pc or {}).get("score")
        today_sector = (tc or {}).get("sector")
        previous_sector = (pc or {}).get("sector")
        today_stage = (tc or {}).get("stage")
        previous_stage = (pc or {}).get("stage")

        rank_delta = None
        if today_rank is not None and previous_rank is not None:
            rank_delta = today_rank - previous_rank
        score_delta = None
        if isinstance(today_score, (int, float)) and isinstance(previous_score, (int, float)):
            score_delta = round(float(today_score) - float(previous_score), 2)
        sector_changed = (
            today_sector is not None
            and previous_sector is not None
            and today_sector != previous_sector
        )

        primary: str | None = None
        if today_rank is not None and previous_rank is None:
            primary = "NEW"
        elif today_rank is None and previous_rank is not None:
            primary = "DEPARTED"
        elif rank_delta is not None and rank_delta < 0:
            primary = "RANK_UP"
        elif rank_delta is not None and rank_delta > 0:
            primary = "RANK_DOWN"
        elif score_delta is not None and score_delta >= SCORE_THRESHOLD:
            primary = "SCORE_UP"
        elif score_delta is not None and score_delta <= -SCORE_THRESHOLD:
            primary = "SCORE_DOWN"
        elif sector_changed:
            primary = "SECTOR_CHANGE"
        if primary is None:
            continue

        rows.append({
            "ticker": t,
            "name": (tc or {}).get("name") or (pc or {}).get("name"),
            "today_rank": today_rank,
            "previous_rank": previous_rank,
            "yesterday_rank": previous_rank,
            "rank_delta": rank_delta,
            "today_score": today_score,
            "previous_score": previous_score,
            "yesterday_score": previous_score,
            "score_delta": score_delta,
            "today_sector": today_sector,
            "previous_sector": previous_sector,
            "yesterday_sector": previous_sector,
            "sector_changed": sector_changed,
            "today_stage": today_stage,
            "previous_stage": previous_stage,
            "yesterday_stage": previous_stage,
            "change_type": primary,
        })

    type_order = {
        "NEW": 0, "DEPARTED": 1, "RANK_UP": 2, "RANK_DOWN": 3,
        "SCORE_UP": 4, "SCORE_DOWN": 5, "SECTOR_CHANGE": 6,
    }

    def _sort_key(r: dict):
        ct = r["change_type"]
        order = type_order.get(ct, 9)
        rd = r.get("rank_delta")
        sd = r.get("score_delta")
        sec = 0
        if ct == "RANK_UP":
            sec = rd if rd is not None else 0
        elif ct == "RANK_DOWN":
            sec = -(rd if rd is not None else 0)
        elif ct == "SCORE_UP":
            sec = -(sd if sd is not None else 0)
        elif ct == "SCORE_DOWN":
            sec = sd if sd is not None else 0
        elif ct == "NEW":
            sec = r.get("today_rank") or 9999
        elif ct == "DEPARTED":
            sec = r.get("previous_rank") or 9999
        return (order, sec)

    rows.sort(key=_sort_key)
    return rows


def summarize(rows: list[dict]) -> dict[str, int]:
    s = {
        "n_new_entries": 0, "n_departed": 0,
        "n_rank_up": 0, "n_rank_down": 0,
        "n_score_up": 0, "n_score_down": 0,
        "n_sector_changed": 0, "n_total_changes": len(rows),
    }
    for r in rows:
        ct = r["change_type"]
        if ct == "NEW":
            s["n_new_entries"] += 1
        elif ct == "DEPARTED":
            s["n_departed"] += 1
        elif ct == "RANK_UP":
            s["n_rank_up"] += 1
        elif ct == "RANK_DOWN":
            s["n_rank_down"] += 1
        elif ct == "SCORE_UP":
            s["n_score_up"] += 1
        elif ct == "SCORE_DOWN":
            s["n_score_down"] += 1
        if r.get("sector_changed"):
            s["n_sector_changed"] += 1
    return s


def write_output(payload: dict) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print("[compare_snapshots] change dump saved: logs/sidecar/change_dump_latest.json")


def empty_result(status: str, message: str,
                 today_path: str | None = None,
                 previous_path: str | None = None,
                 today_date: str | None = None,
                 previous_date: str | None = None) -> dict:
    label = f"{today_date} vs {previous_date}" if today_date and previous_date else (today_date or "-")
    return {
        "generated_at": now_iso_kst(),
        "today_date": today_date,
        "previous_date": previous_date,
        "yesterday_date": previous_date,
        "today_path": today_path,
        "previous_path": previous_path,
        "yesterday_path": previous_path,
        "compare_label": label,
        "status": status,
        "message": message,
        "summary": {
            "n_new_entries": 0, "n_departed": 0,
            "n_rank_up": 0, "n_rank_down": 0,
            "n_score_up": 0, "n_score_down": 0,
            "n_sector_changed": 0, "n_total_changes": 0,
        },
        "changes": [],
    }


MSG_NOT_ENOUGH = (
    "Previous-snapshot comparison needs at least 2 snapshots. "
    "Run run_daily.bat (or run_sidecar.bat) again so logs/sidecar/daily/ "
    "has both today and a previous file."
)
MSG_PARSE_FAIL = "Snapshot JSON parse failed; the file may be corrupted."


def main() -> int:
    try:
        snaps = discover_snapshots()
        if len(snaps) < 2:
            count = len(snaps)
            msg = f"{MSG_NOT_ENOUGH} (currently {count} snapshot(s))"
            print(f"[compare_snapshots][WARN] {msg}")
            payload = empty_result(
                status="not_enough_snapshots",
                message=msg,
                today_date=snaps[0][0] if snaps else None,
                today_path=str(snaps[0][1].relative_to(ROOT).as_posix()) if snaps else None,
            )
            write_output(payload)
            print("[compare_snapshots] done")
            return 0

        (today_date, today_path), (previous_date, previous_path) = snaps[0], snaps[1]
        today_scan = load_json(today_path)
        previous_scan = load_json(previous_path)

        if today_scan is None or previous_scan is None:
            print(f"[compare_snapshots][WARN] {MSG_PARSE_FAIL}")
            payload = empty_result(
                status="parse_error", message=MSG_PARSE_FAIL,
                today_date=today_date, previous_date=previous_date,
                today_path=str(today_path.relative_to(ROOT).as_posix()),
                previous_path=str(previous_path.relative_to(ROOT).as_posix()),
            )
            write_output(payload)
            print("[compare_snapshots] done")
            return 0

        today_ctx = build_context(today_scan)
        previous_ctx = build_context(previous_scan)
        rows = diff(today_ctx, previous_ctx)
        summary = summarize(rows)

        today_path_rel = today_path.relative_to(ROOT).as_posix()
        previous_path_rel = previous_path.relative_to(ROOT).as_posix()
        payload = {
            "generated_at": now_iso_kst(),
            "today_date": today_date,
            "previous_date": previous_date,
            "yesterday_date": previous_date,
            "today_path": today_path_rel,
            "previous_path": previous_path_rel,
            "yesterday_path": previous_path_rel,
            "compare_label": f"{today_date} vs {previous_date}",
            "status": "ok",
            "message": "OK - previous snapshot vs today (the two dates are not guaranteed to be consecutive).",
            "summary": summary,
            "changes": rows,
        }
        write_output(payload)
        print(
            f"[compare_snapshots] compare {today_date} vs {previous_date} (previous snapshot): "
            f"NEW={summary['n_new_entries']} DEP={summary['n_departed']} "
            f"R+={summary['n_rank_up']} R-={summary['n_rank_down']} "
            f"S+={summary['n_score_up']} S-={summary['n_score_down']} "
            f"SECTOR={summary['n_sector_changed']} TOTAL={summary['n_total_changes']}"
        )
        print("[compare_snapshots] done")
        return 0
    except Exception as e:
        print(f"[compare_snapshots][WARN] unexpected error: {e}")
        traceback.print_exc()
        try:
            payload = empty_result(status="error", message=f"unexpected error: {e}")
            write_output(payload)
        except Exception:
            pass
        print("[compare_snapshots] done")
        return 0


if __name__ == "__main__":
    sys.exit(main())
