/**
 * Next.js Edge Middleware.
 *
 * 책임:
 *   1) Supabase auth 쿠키를 매 요청에서 refresh (SSR 신뢰성).
 *   2) /admin 경로는 로그인 필수. 미로그인 → /login?next=... 로 리다이렉트.
 *      (실제 role 검사는 /admin 루트 RSC 의 requireAdmin() 에서 추가로 수행.)
 *   3) 베타 단계에서 INVITE_CODES 가 설정되어 있으면 /start/* 에 쿠키 검사.
 *      초대 코드가 없는 브라우저가 오면 /waitlist 로 보냄.
 *   4) 정적 자원 / api / 인증 경로는 제외 (matcher).
 *
 * 주의: Edge runtime 에서 Node 전용 패키지를 쓰지 않는다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const INVITE_COOKIE = "lucid_invite_ok";

function supabaseFromMiddleware(req: NextRequest, res: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createServerClient(url, anon, {
    cookies: {
      getAll: () =>
        req.cookies.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (
        all: { name: string; value: string; options: CookieOptions }[],
      ) => {
        all.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
  });
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  // 1) Auth cookie refresh
  const sb = supabaseFromMiddleware(req, res);
  let userId: string | null = null;
  if (sb) {
    try {
      const {
        data: { user },
      } = await sb.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      // ignore — downstream handlers will treat as unauthenticated
    }
  }

  // 2) /admin 보호
  if (pathname.startsWith("/admin")) {
    if (!userId) {
      const next = encodeURIComponent(pathname + req.nextUrl.search);
      return NextResponse.redirect(
        new URL(`/login?next=${next}`, req.url),
      );
    }
  }

  // 2.5) 본서비스 로그인 필수 (hardcoded — /trial/* 은 예외)
  const isMainService =
    pathname.startsWith("/start") || pathname.startsWith("/session");
  if (isMainService && !userId) {
    const next = encodeURIComponent(pathname + req.nextUrl.search);
    return NextResponse.redirect(new URL(`/login?next=${next}`, req.url));
  }

  // 3) 초대 코드 게이트 (베타)
  const inviteList = (process.env.INVITE_CODES ?? "").trim();
  if (inviteList.length > 0) {
    const isProtectedEntry =
      pathname === "/" ||
      pathname.startsWith("/start") ||
      pathname.startsWith("/session");
    if (isProtectedEntry) {
      const hasOk = req.cookies.get(INVITE_COOKIE)?.value === "1";
      const codeInQuery = req.nextUrl.searchParams.get("invite");
      if (hasOk) {
        // pass
      } else if (
        codeInQuery &&
        inviteList.split(/\s+/).filter(Boolean).includes(codeInQuery)
      ) {
        res.cookies.set(INVITE_COOKIE, "1", {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
        });
      } else if (!userId) {
        return NextResponse.redirect(new URL("/waitlist", req.url));
      }
    }
  }

  return res;
}

/**
 * 정적 자산/웹훅은 제외. /api 는 자체 인증 로직이 있으므로 제외.
 * /api/billing/webhook은 Stripe 서명 검증에 영향 없게 반드시 제외해야 한다.
 */
export const config = {
  matcher: [
    "/((?!api/|_next/|favicon\\.ico|robots\\.txt|sitemap\\.xml|assets/|images/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|map)$).*)",
  ],
};
