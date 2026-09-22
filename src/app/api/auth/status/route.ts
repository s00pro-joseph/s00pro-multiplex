import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * 认证初始化状态（无需登录，供中间件做 fail-closed 分流）。
 * initialized=true → 有站长（环境变量或数据库），走正常登录。
 * initialized=false → 无站长，走一次性初始化设置。
 */
export async function GET() {
  try {
    const initialized = await db.hasAnyOwner();
    return NextResponse.json({ initialized });
  } catch {
    // 读不到就当没有，调用方 fail-closed
    return NextResponse.json({ initialized: false });
  }
}
