import { NextRequest, NextResponse } from 'next/server';
import { getAuthInfoFromCookie, verifyAuthCookie } from '@/lib/auth';

// 定义不需要认证的公开路径
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/api/login',
  '/api/register',
  '/api/bing-wallpaper',
  '/api/server-config',
  '/api/telegram',
  '/api/oidc',
  '/manifest.json',
  '/sw.js',
  '/mitm.html',
  '/robots.txt',
  '/favicon.ico',
  '/icons/',
  '/weights/',
];

// 定义以特定前缀开头的公开路径
const PUBLIC_PREFIXES = [
  '/_next/',
  '/api/auth/', // NextAuth 兼容
];

function isPublicPath(pathname: string): boolean {
  // 精确匹配
  if (PUBLIC_PATHS.some((p) => pathname === p)) return true;

  // 前缀匹配
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;

  // 静态资源
  if (
    pathname.match(
      /\.(ico|png|jpg|jpeg|svg|webp|css|js|map|woff|woff2|ttf|eot)$/,
    )
  )
    return true;

  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 放行公开路径
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 从 cookie 获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  // 验证 cookie 签名和过期时间
  const isValid = await verifyAuthCookie(authInfo);

  if (!isValid) {
    // 未认证，重定向到登录页，保存原目标用于登录后跳回
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // 认证通过，继续
  return NextResponse.next();
}

export const config = {
  // 匹配所有路由，但通过 isPublicPath 过滤
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};
