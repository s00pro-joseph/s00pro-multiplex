/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, getServerSecret } from '@/lib/auth';

// 信任网络配置缓存（从 API 获取）
let trustedNetworkCache: { enabled: boolean; trustedIPs: string[]; blockAdminAccess: boolean } | null = null;
let trustedNetworkCacheTime = 0;
let trustedNetworkFetched = false;
let trustedNetworkVersion = ''; // 跟踪配置版本，用于立即失效缓存

const CACHE_TTL = 86400000; // 24 小时缓存（配置变化时通过 cookie 版本号立即刷新）

// 从环境变量获取信任网络配置（优先）
function getTrustedNetworkFromEnv(): { enabled: boolean; trustedIPs: string[]; blockAdminAccess: boolean } | null {
  const trustedIPs = process.env.TRUSTED_NETWORK_IPS;
  if (!trustedIPs) return null;

  return {
    enabled: true,
    trustedIPs: trustedIPs.split(',').map(ip => ip.trim()).filter(Boolean),
    blockAdminAccess: false,
  };
}

// 从 API 获取信任网络配置（数据库）
async function getTrustedNetworkFromAPI(request: NextRequest): Promise<{ enabled: boolean; trustedIPs: string[]; blockAdminAccess: boolean } | null> {
  const now = Date.now();

  // 检查缓存是否有效
  if (trustedNetworkFetched && trustedNetworkCache !== null) {
    if ((now - trustedNetworkCacheTime) < CACHE_TTL) {
      if (!trustedNetworkCache.enabled) {
        return null;
      }
      return trustedNetworkCache;
    }
  }

  // 如果已经获取过且结果是"未配置"，使用长缓存时间
  if (trustedNetworkFetched && trustedNetworkCache === null) {
    if ((now - trustedNetworkCacheTime) < CACHE_TTL) {
      return null;
    }
  }

  try {
    const url = new URL('/api/server-config', request.url);
    url.searchParams.set('key', 'TrustedNetworkConfig');

    const response = await fetch(url.toString(), {
      headers: {
        'x-internal-request': 'true',
      },
    });

    trustedNetworkFetched = true;
    trustedNetworkCacheTime = now;

    if (response.ok) {
      const data = await response.json();
      if (data.TrustedNetworkConfig) {
        trustedNetworkCache = {
          enabled: data.TrustedNetworkConfig.enabled ?? false,
          trustedIPs: data.TrustedNetworkConfig.trustedIPs || [],
          blockAdminAccess: data.TrustedNetworkConfig.blockAdminAccess === true,
        };

        if (!trustedNetworkCache.enabled) {
          return null;
        }

        return trustedNetworkCache;
      }
    }

    // API 返回但没有配置 - 标记为禁用而不是 null，这样走禁用缓存逻辑
    trustedNetworkCache = { enabled: false, trustedIPs: [], blockAdminAccess: false };
  } catch {
    // 请求失败时标记为禁用，使用长缓存时间避免频繁重试
    trustedNetworkCache = { enabled: false, trustedIPs: [], blockAdminAccess: false };
  }

  return null;
}

// 获取信任网络配置（环境变量优先，然后数据库）
async function getTrustedNetworkConfig(request: NextRequest): Promise<{ enabled: boolean; trustedIPs: string[]; blockAdminAccess: boolean } | null> {
  // 环境变量优先
  const envConfig = getTrustedNetworkFromEnv();
  if (envConfig) return envConfig;

  // 检查 cookie 中的配置版本号
  // 管理页面保存配置时会更新这个 cookie，版本号变化时强制刷新缓存
  const cookieVersion = request.cookies.get('tn-version')?.value || '';
  if (cookieVersion && cookieVersion !== trustedNetworkVersion) {
    // 版本号变了，强制清除缓存，立即重新获取
    trustedNetworkCache = null;
    trustedNetworkFetched = false;
    trustedNetworkVersion = cookieVersion;
  }

  // 尝试从数据库获取（内部已处理禁用状态的缓存优化）
  return await getTrustedNetworkFromAPI(request);
}

// 初始化状态缓存（从 API 获取，避免每个请求都打库）
let initStatusCache: boolean | null = null;
let initStatusCacheTime = 0;
const INIT_STATUS_TTL = 60 * 1000; // 60 秒

async function getInitStatusFromAPI(request: NextRequest): Promise<boolean> {
  const now = Date.now();
  if (initStatusCache !== null && now - initStatusCacheTime < INIT_STATUS_TTL) {
    return initStatusCache;
  }
  try {
    const url = new URL('/api/auth/status', request.url);
    const response = await fetch(url.toString(), {
      headers: { 'x-internal-request': 'true' },
    });
    if (response.ok) {
      const data = await response.json();
      initStatusCache = data.initialized === true;
      initStatusCacheTime = now;
      return initStatusCache;
    }
  } catch {
    // 读不到就当没有，调用方 fail-closed
  }
  return false;
}

// 会话校验缓存（按 cookie 值，30 秒；改密后最多延迟 30 秒全网生效）
const sessionCheckCache = new Map<string, { ok: boolean; at: number }>();
const SESSION_CHECK_TTL = 30 * 1000;

async function checkSessionViaAPI(
  request: NextRequest,
  rawCookie: string,
  auth: { username?: string; signature?: string; timestamp?: number; loginTime?: number; trustedNetwork?: boolean; role?: string; pwdv?: number; exp?: number },
): Promise<boolean> {
  const now = Date.now();
  const cached = sessionCheckCache.get(rawCookie);
  if (cached && now - cached.at < SESSION_CHECK_TTL) return cached.ok;
  try {
    const url = new URL('/api/auth/check', request.url);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-request': 'true',
      },
      body: JSON.stringify({ auth }),
    });
    const ok = response.ok && ((await response.json()).ok === true);
    sessionCheckCache.set(rawCookie, { ok, at: now });
    if (sessionCheckCache.size > 200) {
      const first = sessionCheckCache.keys().next().value;
      if (first) sessionCheckCache.delete(first);
    }
    return ok;
  } catch {
    return false;
  }
}

// 常见弱默认密码/凭据黑名单（小写比对）。命中时视同未配置密码，
// 强制走 /warning 页而不是静默放行——这类值通常来自教程截图、示例配置复制粘贴。
const WEAK_DEFAULT_CREDENTIALS = new Set([
  'admin',
  'admin123',
  'password',
  'password123',
  '123456',
  '12345678',
  'changeme',
  'letmein',
  'lunatv',
  'moontv',
]);

function isWeakDefaultCredential(value: string): boolean {
  return WEAK_DEFAULT_CREDENTIALS.has(value.toLowerCase());
}

// 获取客户端 IP
function getClientIP(request: NextRequest): string {
  // 按优先级获取客户端 IP
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

// 简化的 IP/CIDR 匹配（Edge Runtime 兼容）
function isIPInCIDR(clientIP: string, cidr: string): boolean {
  // 处理通配符
  if (cidr === '*') return true;

  // 检测 IPv6
  const isClientIPv6 = clientIP.includes(':');
  const isCIDRIPv6 = cidr.includes(':');

  // IPv4 和 IPv6 不能互相匹配
  if (isClientIPv6 !== isCIDRIPv6) return false;

  if (isClientIPv6) {
    // IPv6 简化匹配：只支持精确匹配和简单前缀匹配
    if (cidr.includes('/')) {
      const [network] = cidr.split('/');
      // 简化：检查是否以相同前缀开始
      return clientIP.toLowerCase().startsWith(network.toLowerCase().replace(/:+$/, ''));
    }
    return clientIP.toLowerCase() === cidr.toLowerCase();
  }

  // IPv4 CIDR 匹配
  if (cidr.includes('/')) {
    const [network, maskStr] = cidr.split('/');
    const mask = parseInt(maskStr, 10);

    const networkParts = network.split('.').map(Number);
    const clientParts = clientIP.split('.').map(Number);

    if (clientParts.length !== 4 || networkParts.length !== 4) return false;
    if (clientParts.some(p => isNaN(p)) || networkParts.some(p => isNaN(p))) return false;

    // 转换为 32 位整数
    const networkInt = (networkParts[0] << 24) | (networkParts[1] << 16) | (networkParts[2] << 8) | networkParts[3];
    const clientInt = (clientParts[0] << 24) | (clientParts[1] << 16) | (clientParts[2] << 8) | clientParts[3];

    // 生成掩码
    const maskInt = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;

    return (networkInt & maskInt) === (clientInt & maskInt);
  }

  // 精确 IP 匹配
  return clientIP === cidr;
}

// 检查 IP 是否在信任网络中
function isIPTrusted(clientIP: string, trustedIPs: string[]): boolean {
  return trustedIPs.some(trustedIP => isIPInCIDR(clientIP, trustedIP.trim()));
}

// 生成信任网络的自动登录 cookie
function generateTrustedAuthCookie(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const username = process.env.USERNAME || 'admin';

  if (storageType === 'localstorage') {
    // localstorage 模式：设置密码 cookie
    const authInfo = {
      password: process.env.PASSWORD,
      loginTime: Date.now(),
    };
    response.cookies.set('user_auth', JSON.stringify(authInfo), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 天
    });
  } else {
    // 数据库模式：生成签名 cookie（需要异步，这里简化处理）
    // 在信任网络模式下，我们设置一个特殊的信任标记
    const authInfo = {
      username,
      trustedNetwork: true,
      timestamp: Date.now(),
      loginTime: Date.now(),
      role: 'owner',
    };
    response.cookies.set('user_auth', JSON.stringify(authInfo), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 天
    });
  }

  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 处理 /adult/ 路径前缀，重写为实际 API 路径
  if (pathname.startsWith('/adult/')) {
    // 移除 /adult 前缀
    const newPathname = pathname.replace(/^\/adult/, '');

    // 创建新的 URL
    const url = request.nextUrl.clone();
    url.pathname = newPathname || '/';

    // 添加 adult=1 参数（如果还没有；显式写回 search 确保持久化）
    const params = new URLSearchParams(url.searchParams.toString());
    if (!params.has('adult')) {
      params.set('adult', '1');
    }
    url.search = params.toString();

    // 重写请求（显式字符串，确保改写后的 query 生效）
    // 同时经请求头透传成人频道标记（rewrite 在部分版本不保留改写后的 query）
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-adult-channel', '1');
    const response = NextResponse.rewrite(url.toString(), {
      request: { headers: requestHeaders },
    });

    // 设置响应头标识成人内容模式
    response.headers.set('X-Content-Mode', 'adult');

    // 继续执行认证检查（对于 API 路径）
    if (newPathname.startsWith('/api')) {
      // 将重写后的请求传递给认证逻辑
      const modifiedRequest = new NextRequest(url, request);
      return handleAuthentication(modifiedRequest, newPathname, response);
    }

    return response;
  }

  // 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  return handleAuthentication(request, pathname);
}

// 提取认证处理逻辑为单独的函数
async function handleAuthentication(
  request: NextRequest,
  pathname: string,
  response?: NextResponse
) {
  // 🔥 检查信任网络模式（环境变量优先，然后数据库）
  const trustedNetworkConfig = await getTrustedNetworkConfig(request);
  if (trustedNetworkConfig?.enabled && trustedNetworkConfig.trustedIPs.length > 0) {
    const clientIP = getClientIP(request);

    if (isIPTrusted(clientIP, trustedNetworkConfig.trustedIPs)) {
      // 加固开关：禁止信任网络访客访问后台
      // 命中 /admin 或 /api/admin/* 时，跳过自动登录分支，落到下方密码/签名校验
      const isAdminPath =
        pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
      if (trustedNetworkConfig.blockAdminAccess && isAdminPath) {
        // 不签发也不复用 trustedNetwork cookie，让请求走标准认证流程
        // 后面 authInfo.trustedNetwork 短路那里还会再拦一次（针对已有 cookie 的情况）
      } else {
        console.log(`[Middleware] Trusted network auto-login for IP: ${clientIP}`);

        // 检查是否已经有有效的认证 cookie
        const existingAuth = getAuthInfoFromCookie(request);
        if (existingAuth && (existingAuth.password || existingAuth.trustedNetwork || existingAuth.signature)) {
          return response || NextResponse.next();
        }

        // 没有认证 cookie，自动生成并设置
        return generateTrustedAuthCookie(request);
      }
    }
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (!process.env.PASSWORD) {
    // Fail-closed：无环境密码时看数据库是否有站长。
    // 无站长 → 只放行初始化路径，其余一律去 /setup；有站长 → 走正常登录流程。
    const initialized = await getInitStatusFromAPI(request);
    const isSetupPath =
      pathname === '/setup' ||
      pathname.startsWith('/setup/') ||
      pathname === '/api/auth/setup' ||
      pathname === '/api/auth/status';
    if (!initialized) {
      if (isSetupPath) return response || NextResponse.next();
      return NextResponse.redirect(new URL('/setup', request.url));
    }
    if (isSetupPath && pathname !== '/api/auth/status') {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  if (isWeakDefaultCredential(process.env.PASSWORD)) {
    // 已设置密码，但命中常见弱默认值黑名单（admin/admin123/password等）——
    // 用不同的 reason 参数区分，避免用户误以为环境变量没生效
    const warningUrl = new URL('/warning', request.url);
    warningUrl.searchParams.set('reason', 'weak-password');
    return NextResponse.redirect(warningUrl);
  }

  // 从cookie获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // 过期即失效（持久登录 365 天；会话登录靠浏览器 cookie 生命周期）
  if (authInfo.exp && Date.now() > authInfo.exp) {
    return handleAuthFailure(request, pathname);
  }

  // localstorage模式：在middleware中完成验证
  if (storageType === 'localstorage') {
    if (!authInfo.password || authInfo.password !== process.env.PASSWORD) {
      return handleAuthFailure(request, pathname);
    }
    return response || NextResponse.next();
  }

  // 其他模式：验证签名或信任网络标记
  // 🔥 信任网络模式：检查 trustedNetwork 标记
  if (authInfo.trustedNetwork) {
    // 加固开关：信任网络访客的 cookie 不允许进入后台
    if (
      trustedNetworkConfig?.blockAdminAccess &&
      (pathname.startsWith('/admin') || pathname.startsWith('/api/admin'))
    ) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return response || NextResponse.next();
  }

  // 检查是否有用户名（非localStorage模式下密码不存储在cookie中）
  if (!authInfo.username || !authInfo.signature) {
    return handleAuthFailure(request, pathname);
  }

  // 验证签名（如果存在）
  if (authInfo.signature) {
    const isValidSignature = await verifySignature(
      authInfo.username,
      authInfo.signature,
      getServerSecret()
    );

    // 签名验证通过即可
    if (isValidSignature) {
      // 数据库用户：再经内部接口核对密码版本（改密即全网失效，最多 30 秒延迟）
      if (authInfo.username !== process.env.USERNAME) {
        const rawCookie =
          request.cookies.get('user_auth')?.value ||
          request.cookies.get('auth')?.value ||
          '';
        const sessionOk = await checkSessionViaAPI(request, rawCookie, authInfo);
        if (!sessionOk) return handleAuthFailure(request, pathname);
      }
      return response || NextResponse.next();
    }
  }

  // 签名验证失败或不存在签名
  return handleAuthFailure(request, pathname);
}

// 验证签名
async function verifySignature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  try {
    // 导入密钥
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 将十六进制字符串转换为Uint8Array
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    // 验证签名
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData
    );
  } catch (error) {
    console.error('签名验证失败:', error);
    return false;
  }
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string
): NextResponse {
  // 如果是 API 路由，返回 401 状态码
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 否则重定向到登录页面
  const loginUrl = new URL('/login', request.url);
  // 保留完整的URL，包括查询参数
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  return NextResponse.redirect(loginUrl);
}

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/api/telegram/', // Telegram API 端点
    '/api/cache/', // 缓存 API 端点（内部使用，无需认证）
    '/api/client-log', // 客户端日志收集端点（无需认证）
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 配置middleware匹配规则
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|setup|register|oidc-register|warning|api/login|api/register|api/logout|api/auth/setup|api/auth/status|api/auth/check|api/cron|api/server-config|api/live/merged|api/parse|api/bing-wallpaper|api/proxy/|api/telegram/|api/auth/oidc/).*)',
  ],
};
