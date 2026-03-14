import { NextRequest, NextResponse } from "next/server";

const PUBLIC_FILE = /\.(.*)$/;

function prefersFrench(header: string | null): boolean {
  if (!header) {
    return false;
  }

  return header
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .some((value) => value.startsWith("fr"));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (pathname === "/" && prefersFrench(request.headers.get("accept-language"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/fr";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};