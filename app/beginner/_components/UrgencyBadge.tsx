// app/beginner/_components/UrgencyBadge.tsx
// v0.4-1 서버 컴포넌트 — 확인 필요도 5 등급 뱃지

import { UrgencyLevel, URGENCY_LABEL, URGENCY_BADGE_CLASS } from '../../_lib/today_brief';

export function UrgencyBadge({ level }: { level: UrgencyLevel }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${URGENCY_BADGE_CLASS[level]}`}>
      {URGENCY_LABEL[level]}
    </span>
  );
}
