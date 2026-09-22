import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { describeSelection } from '@/lib/source-select';
import { getHealthSnapshot } from '@/lib/source-health';

export const runtime = 'nodejs';

/**
 * 源监控：9-actives 入选 + 健康度快照（站长/管理员可见）。
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getConfig();
  if (authInfo.username !== process.env.USERNAME) {
    const user = config.UserConfig.Users.find((u) => u.username === authInfo.username);
    if (!user || user.role !== 'admin' || user.banned) {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }
  }

  const sites = await getAvailableApiSites(authInfo.username);
  return NextResponse.json({
    selection: describeSelection(sites),
    health: getHealthSnapshot(),
    total: sites.length,
  });
}
