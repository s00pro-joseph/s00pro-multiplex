import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { verifyAuthCookieWithVersion, type AuthCookieData } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * 内部会话校验（供 Edge 中间件调用，打破 Edge 无法读库的限制）。
 * 完整校验：签名 + 过期 + 密码版本。仅接受内网调用，不做访问控制，
 * 返回信息仅为布尔值，不泄露任何用户数据。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { auth?: AuthCookieData };
    if (!body || typeof body.auth !== 'object' || !body.auth) {
      return NextResponse.json({ ok: false });
    }
    const ok = await verifyAuthCookieWithVersion(body.auth, db);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
