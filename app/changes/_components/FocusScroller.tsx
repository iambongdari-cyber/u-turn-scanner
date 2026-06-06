'use client';

// v0.3-13: /changes?focus=<key> 진입 시 해당 카드 위치로 자동 스크롤.
// - 카드 5개에 id="focus-<key>" 가 부착되어 있다는 전제 (key: new | out | up | down | score).
// - "sector" 키는 현 시점 매칭 대상이 없어 스크롤 대상도 없음 — 안전하게 무시.
// - 서버 컴포넌트(/changes/page.tsx)에서 클라이언트 wrapper로 1줄 삽입한다.
// - 기존 ring 강조(v0.3-12)는 그대로 유지.

import { useEffect } from 'react';

export default function FocusScroller({ focus }: { focus: string | null }) {
  useEffect(() => {
    if (!focus) return;
    // 화이트리스트 (FocusKey 와 일치). normalizeFocus 가 서버에서 이미 검증하지만 안전 차원.
    const allowed = new Set(['new', 'out', 'up', 'down', 'score']);
    if (!allowed.has(focus)) return;

    // 서버 렌더 직후 레이아웃 안정화를 위해 약간의 지연 후 스크롤.
    const t = setTimeout(() => {
      const el = document.getElementById(`focus-${focus}`);
      if (!el) return;
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        // 구형 브라우저 fallback — 옵션 없이 호출
        el.scrollIntoView();
      }
    }, 50);

    return () => clearTimeout(t);
  }, [focus]);

  // 렌더 출력 없음
  return null;
}
