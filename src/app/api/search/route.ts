/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { selectActiveSources, sortByResourcesDesc } from '@/lib/source-select';
import { searchFromApi } from '@/lib/downstream';
import { generateSearchVariants } from '@/lib/downstream';
import { fetchDoubanAnchors } from '@/lib/douban-suggest';
import { recordRequest, getDbQueryCount, resetDbQueryCount } from '@/lib/performance-monitor';
import {
  buildResolutionFilterFromSearchParams,
  filterSearchResultsByResolution,
} from '@/lib/video-quality';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  resetDbQueryCount();

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    const errorResponse = { error: 'Unauthorized' };
    const errorSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/search',
      statusCode: 401,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize: errorSize,
    });

    return NextResponse.json(errorResponse, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const resolutionFilter = buildResolutionFilterFromSearchParams(searchParams);

  if (!query) {
    const cacheTime = await getCacheTime();
    const successResponse = { results: [] };
    const responseSize = Buffer.byteLength(JSON.stringify(successResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/search',
      statusCode: 200,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize,
      filter: 'empty-query',
    });

    return NextResponse.json(
      successResponse,
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  }

  const config = await getConfig();
  // 成人频道（/adult 前缀由 proxy 改写：query adult=1 或请求头 x-adult-channel）
  const adultChannel =
    searchParams.get('adult') === '1' || request.headers.get('x-adult-channel') === '1';
  const allApiSites = await getAvailableApiSites(authInfo.username, { adultChannel });
  // 9-actives：每档 top-3（健康度已在内部过滤降级源）
  // 库越大越先搜：大库先行，小库随后，未知库容垫底（权重只做同量级 tiebreak）
  const apiSites = sortByResourcesDesc(selectActiveSources(allApiSites));
  const weightOf = new Map(allApiSites.map((s) => [s.key, s.weight ?? 50]));
  const sizeOf = new Map(allApiSites.map((s) => [s.key, s.probeResources ?? -1]));

  // 结果上限：默认 250，More 按钮用 all=1 取全部
  const wantAll = searchParams.get('all') === '1';
  const RESULT_LIMIT = 250;

  // 优化：预计算搜索变体，智能生成（普通查询1个，需要变体的2个）
  const searchVariants = generateSearchVariants(query);

  // 豆瓣锚点与 CMS 并发（互不阻塞，锚点失败即无锚点）
  const doubanPromise = fetchDoubanAnchors(query).catch(() => []);

  // 添加超时控制和错误处理，避免慢接口拖累整体响应
  const searchPromises = apiSites.map((site) =>
    Promise.race([
      searchFromApi(site, query, searchVariants), // 传入预计算的变体
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${site.name} timeout`)), 10000)
      ),
    ]).catch((err) => {
      console.warn(`搜索失败 ${site.name}:`, err.message);
      return []; // 返回空数组而不是抛出错误
    })
  );

  try {
    const results = await Promise.allSettled(searchPromises);
    const successResults = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => (result as PromiseFulfilledResult<any>).value);
    let flattenedResults = successResults.flat();
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    // 分辨率过滤（resolution 已在 downstream 解析阶段装饰）
    flattenedResults = filterSearchResultsByResolution(flattenedResults, resolutionFilter);

    // 豆瓣+CMS 合并（成人频道不混入豆瓣锚点，保持频道纯净）
    const doubanAnchors = adultChannel ? [] : await doubanPromise;
    if (doubanAnchors.length > 0) {
      const seenDouban = new Set(
        flattenedResults
          .filter((r) => r.douban_id)
          .map((r) => String(r.douban_id)),
      );
      for (const anchor of doubanAnchors) {
        if (anchor.douban_id && seenDouban.has(String(anchor.douban_id))) continue;
        flattenedResults.push(anchor);
      }
    }

    // 排序：豆瓣锚点置顶，其余按源库容从大到小（同量级按权重）
    weightOf.set('douban', 100);
    flattenedResults.sort((a, b) => {
      const aAnchor = a.source === 'douban' ? 1 : 0;
      const bAnchor = b.source === 'douban' ? 1 : 0;
      if (aAnchor !== bAnchor) return bAnchor - aAnchor;
      const sizeDiff = (sizeOf.get(b.source) ?? -1) - (sizeOf.get(a.source) ?? -1);
      if (sizeDiff !== 0) return sizeDiff;
      return (weightOf.get(b.source) ?? 50) - (weightOf.get(a.source) ?? 50);
    });
    const totalCount = flattenedResults.length;
    const limitedResults = wantAll ? flattenedResults : flattenedResults.slice(0, RESULT_LIMIT);
    const cacheTime = await getCacheTime();

    if (flattenedResults.length === 0) {
      // no cache if empty
      const emptyResponse = { results: [] };
      const responseSize = Buffer.byteLength(JSON.stringify(emptyResponse), 'utf8');

      recordRequest({
        timestamp: startTime,
        method: 'GET',
        path: '/api/search',
        statusCode: 200,
        duration: Date.now() - startTime,
        memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize: 0,
        responseSize,
        filter: `query:${query}`,
      });

      return NextResponse.json(emptyResponse, { status: 200 });
    }

    const successResponse = {
      results: limitedResults,
      total: totalCount,
      limited: !wantAll && totalCount > limitedResults.length,
    };
    const responseSize = Buffer.byteLength(JSON.stringify(successResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/search',
      statusCode: 200,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize,
      filter: `query:${query}`,
    });

    return NextResponse.json(
      successResponse,
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  } catch (error) {
    const errorResponse = { error: '搜索失败' };
    const errorSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/search',
      statusCode: 500,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize: errorSize,
    });

    return NextResponse.json(errorResponse, { status: 500 });
  }
}
