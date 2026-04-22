"use client";

/**
 * 세션 이탈 보호 훅.
 *
 * `dirty === true` 이면 다음 4가지 이탈 경로를 모두 가드:
 *   (a) 브라우저 새로고침 / 탭 닫기 / 윈도우 닫기    → beforeunload 네이티브 경고
 *   (b) 브라우저 뒤로가기 / 앞으로가기              → popstate + 확인 콜백
 *   (c) 페이지 내부 <a> / <Link> 클릭               → click capture 에서 가로채고 onAttempt 호출
 *   (d) router.push 직접 호출                      → 호출 측이 onAttempt 로 직접 물어봐야 함 (훅은 감지 불가)
 *
 * (c) 의 onAttempt 가 `true` 를 반환하면 원래 목적지로 진행 (프로그램 방식 이동).
 * `false` / void 를 반환하면 차단 상태 유지 — 소비 측이 나중에 모달에서 확인 시 navigate() 직접 실행.
 *
 * 이 훅은 window 에 핸들러를 다는 side-effect 성 로직만 담당. UI 모달은 소비 측이 관리.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export interface NavigationAttempt {
  kind: "beforeunload" | "popstate" | "link";
  /** (c) 의 경우 이동하려던 URL. 그 외는 null. */
  href: string | null;
}

export function useNavigationGuard(opts: {
  dirty: boolean;
  onAttempt: (attempt: NavigationAttempt) => void;
}) {
  const { dirty, onAttempt } = opts;
  const pathname = usePathname();
  const handlerRef = useRef(onAttempt);
  handlerRef.current = onAttempt;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // (a) beforeunload — 네이티브 브라우저 확인 창 (문구는 브라우저 고정)
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // Chrome/Edge 가 returnValue 요구. 실제 문구는 브라우저가 표준화.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // (c) 같은 탭 내의 <a>/<Link> 클릭 가로채기.
  //   App Router 는 events API 가 없어서 capture-phase 클릭 리스너가 유일한 범용 수단.
  //   modifier 키(탭으로 열기)·download·target=_blank 는 통과시킨다.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;

      // 같은 경로면 보호할 필요 없음.
      try {
        const url = new URL(anchor.href, window.location.href);
        if (url.pathname === pathname) return;
      } catch {
        return;
      }

      e.preventDefault();
      handlerRef.current({ kind: "link", href: anchor.href });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  // (b) 뒤로가기 / 앞으로가기
  useEffect(() => {
    if (!dirty) return;
    // push 빈 state → 사용자가 뒤로가기를 눌러도 실제 이동 없이 popstate 만 트리거됨.
    window.history.pushState(null, "", window.location.href);
    function onPopState() {
      if (!dirtyRef.current) return;
      // 다시 한 번 pushState 로 사용자가 우리 페이지에 머무르게 한다.
      window.history.pushState(null, "", window.location.href);
      handlerRef.current({ kind: "popstate", href: null });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [dirty]);
}
