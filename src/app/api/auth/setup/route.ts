/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { clearConfigCache } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | 'sqlite'
    | undefined) || 'localstorage';

/**
 * 一次性初始化：创建首个站长账号。
 * 仅当全站无任何站长（环境变量 + 数据库）时可用，否则 403。
 * localstorage 模式不支持（无持久化）。
 */
export async function POST(req: NextRequest) {
  try {
    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: 'localStorage 模式不支持初始化设置' },
        { status: 400 },
      );
    }

    if (await db.hasAnyOwner()) {
      return NextResponse.json({ error: '已初始化，无需重复设置' }, { status: 403 });
    }

    const { username, password, confirmPassword } = await req.json();

    if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json(
        { error: '用户名只能包含字母、数字和下划线，长度3-20位' },
        { status: 400 },
      );
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: '两次输入的密码不一致' }, { status: 400 });
    }

    // 二次确认，防止并发重复初始化
    if (await db.hasAnyOwner()) {
      return NextResponse.json({ error: '已初始化，无需重复设置' }, { status: 403 });
    }

    // V1 存密码（scrypt）+ V2 存站长身份
    await db.registerUser(username, password);
    await db.createUserV2(username, password, 'owner');
    clearConfigCache();

    return NextResponse.json({ ok: true, username });
  } catch (error) {
    console.error('初始化设置失败', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
