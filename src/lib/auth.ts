import { NextRequest } from 'next/server';

export interface AuthCookieData {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  loginTime?: number;
  trustedNetwork?: boolean;
  role?: 'owner' | 'admin' | 'user';
  /** 密码版本（数据库用户）：改密即 bump，旧 cookie 全网失效 */
  pwdv?: number;
  /** 过期时间戳（毫秒）。缺省 = 浏览器会话有效 */
  exp?: number;
}

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): AuthCookieData | null {
  // 尝试新的 cookie 名称 user_auth，如果没有则尝试旧的 auth
  const authCookie = request.cookies.get('user_auth') || request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(authCookie.value);
    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
  }
}

// 从cookie获取认证信息 (客户端使用)
export function getAuthInfoFromBrowserCookie(): AuthCookieData | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const trimmed = cookie.trim();
      const firstEqualIndex = trimmed.indexOf('=');

      if (firstEqualIndex > 0) {
        const key = trimmed.substring(0, firstEqualIndex);
        const value = trimmed.substring(firstEqualIndex + 1);
        if (key && value) {
          acc[key] = value;
        }
      }

      return acc;
    }, {} as Record<string, string>);

    // 尝试新的 cookie 名称 user_auth，如果没有则尝试旧的 auth
    const authCookie = cookies['user_auth'] || cookies['auth'];
    if (!authCookie) {
      return null;
    }

    // 处理可能的双重编码
    let decoded = decodeURIComponent(authCookie);

    // 如果解码后仍然包含 %，说明是双重编码，需要再次解码
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }

    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
  }
}

/**
 * 服务端签名密钥。
 * 优先级：PASSWORD → AUTH_SECRET → 内置 localhost 回退。
 * 回退密钥仅适用于单人本机场景（能读到源码的人本来就有本机权限）；
 * 改 .env 密码即轮换密钥，环境站长旧会话全网失效。
 */
export function getServerSecret(): string {
  return (
    process.env.PASSWORD || process.env.AUTH_SECRET || 's00pro-multiplex-localhost'
  );
}

/**
 * 校验签名（HMAC-SHA256，Edge/Node 通用）。
 * 服务端密钥 = process.env.PASSWORD（改 .env 密码即全网失效环境站长会话）。
 */
export async function verifyAuthSignature(
  username: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!username || !signature || !secret) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || [],
    );
    return await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      encoder.encode(username),
    );
  } catch {
    return false;
  }
}

/**
 * 校验 cookie：签名有效 + 未过期。
 * 不查库（Edge 可用）。调用方如需密码版本校验，用 verifyAuthCookieWithVersion。
 */
export async function verifyAuthCookie(
  auth: AuthCookieData | null,
): Promise<boolean> {
  if (!auth || !auth.username || !auth.signature) return false;
  if (auth.exp && Date.now() > auth.exp) return false;
  return verifyAuthSignature(auth.username, auth.signature, getServerSecret());
}

/**
 * 完整校验：签名 + 过期 + 密码版本（Node 路由用）。
 * 环境站长（username === env USERNAME）：跳过版本（密钥轮换即失效）。
 * 数据库用户：cookie.pwdv 必须等于当前版本，否则视为已改密/已删号。
 */
export async function verifyAuthCookieWithVersion(
  auth: AuthCookieData | null,
  db: { getPwdVersion: (u: string) => Promise<number> },
): Promise<boolean> {
  if (!(await verifyAuthCookie(auth))) return false;
  const username = auth!.username!;
  if (username === process.env.USERNAME) return true;
  const current = await db.getPwdVersion(username);
  return (auth!.pwdv ?? 0) === current;
}
