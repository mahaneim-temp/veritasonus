"use client";

/**
 * 로그인된 사용자에게 보이는 우측 메뉴.
 * - 관리자(admin/superadmin) 면 "관리자" 링크 표시.
 * - 표시 이름(또는 이메일 앞부분) + 로그아웃 버튼.
 * 로그아웃은 브라우저 supabase 클라이언트로 수행한 뒤 전체 리로드(window.location)
 * 해서 middleware 가 만료된 쿠키를 확실히 제거하게 한다.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { supabaseClient } from "@/lib/supabase/client";

export function UserMenu({
  email,
  displayName,
  role,
}: {
  email: string;
  displayName: string | null;
  role: string;
}) {
  const isStaff = role === "admin" || role === "superadmin";
  const label =
    (displayName && displayName.trim().length > 0 && displayName) ||
    email.split("@")[0] ||
    "계정";

  async function logout() {
    try {
      await supabaseClient().auth.signOut();
    } catch {
      // 네트워크 실패해도 화면은 로그아웃 상태로 보내는 게 사용자 기대에 부합.
    }
    window.location.assign("/");
  }

  // staff 는 "관리자" 배지가 이미 신분을 표시하므로 이름 label 을 생략해
  // "관리자 관리자" 같은 중복을 피한다. 일반 회원은 이름/이메일 앞부분 표시.
  return (
    <div className="flex items-center gap-1.5">
      {isStaff ? (
        <Link href={"/admin" as never} title={email}>
          <Button variant="ghost" size="sm" className="text-primary">
            관리자
          </Button>
        </Link>
      ) : (
        <span
          className="text-xs text-ink-secondary hidden sm:inline max-w-[140px] truncate"
          title={email}
        >
          {label}
        </span>
      )}
      <Button variant="ghost" size="sm" onClick={logout}>
        로그아웃
      </Button>
    </div>
  );
}
