/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { fetchCmsLatestPage } from '@/lib/cms-latest';
import { selectActiveSources } from '@/lib/source-select';
import { filterSearchResultsByResolution, buildResolutionFilterFromSearchParams } from '@/lib/video-quality';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

/**
 * 海报墙片库：9-actives 每源 ?ac=videolist&pg= 最新入库
 * 与豆瓣货架合并展示，破 100。成人频道不混入（保持纯净）。
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('pg') || '1', 10) || 1);
  console.log('[Wall] cms request pg=', page);
  const resolutionFilter = buildResolutionFilterFromSearchParams(searchParams);

  const config = await getConfig();
  const allApiSites = await getAvailableApiSites(authInfo.username, { adultChannel: false });
  const apiSites = selectActiveSources(allApiSites);
  const weightOf = new Map(allApiSites.map((s) => [s.key, s.weight ?? 50]));

  const settled = await Promise.allSettled(
    apiSites.map((site) =>
      Promise.race([
        fetchCmsLatestPage(site, page),
        new Promise<any[]>((_, reject) =>
          setTimeout(() => reject(new Error(`${site.name} timeout`)), 10000),
        ),
      ]).catch((err) => {
        console.warn(`片库获取失败 ${site.name}:`, err.message);
        return [] as any[];
      }),
    ),
  );
  let results = settled
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => (r as PromiseFulfilledResult<any[]>).value);

  if (!config.SiteConfig.DisableYellowFilter) {
    results = results.filter((result) => {
      const typeName = result.type_name || '';
      return !yellowWords.some((word: string) => typeName.includes(word));
    });
  }
  results = filterSearchResultsByResolution(results, resolutionFilter);
  results.sort((a, b) => (weightOf.get(b.source) ?? 50) - (weightOf.get(a.source) ?? 50));

  // 上限：每 pg 约 9 源 × 20 条，裁 180
  const RESULT_LIMIT = 180;
  const total = results.length;
  const cacheTime = await getCacheTime();

  return NextResponse.json(
    { results: results.slice(0, RESULT_LIMIT), total, page, hasMore: total > 0 },
    {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    },
  );
}
