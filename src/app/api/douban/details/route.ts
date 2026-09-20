import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { recordRequest } from '@/lib/performance-monitor';
import { DoubanError, fetchMobileApiData, scrapeDoubanDetails } from '@/lib/douban-details.server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const noCache = searchParams.get('nocache') === '1' || searchParams.get('debug') === '1';

  if (!id) {
    // 记录失败请求
    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/douban/details',
      statusCode: 400,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: 0,
      requestSize: 0,
      responseSize: 0,
    });

    return NextResponse.json(
      {
        code: 400,
        message: '缺少必要参数: id',
        error: 'MISSING_PARAMETER',
      },
      { status: 400 }
    );
  }

  try {
    // 并行获取详情和移动端API数据
    const [details, mobileData] = await Promise.all([
      scrapeDoubanDetails(id),
      fetchMobileApiData(id),
    ]);

    // 合并数据：混合使用爬虫和移动端API的优势
    if (details.code === 200 && details.data && mobileData) {
      // 预告片来自移动端API
      details.data.trailerUrl = mobileData.trailerUrl;
      // Backdrop优先使用爬虫的剧照（横版高清），否则用移动端API的海报
      if (!details.data.backdrop && mobileData.backdrop) {
        details.data.backdrop = mobileData.backdrop;
      }
    }

    const cacheTime = await getCacheTime();

    // 🔍 调试模式：绕过缓存
    // 🎬 Trailer安全缓存：30分钟（与移动端API的unstable_cache保持一致）
    // 因为trailer URL有效期约2-3小时，30分钟缓存确保用户拿到的链接仍然有效
    const trailerSafeCacheTime = 1800; // 30分钟
    const cacheHeaders = noCache ? {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Data-Source': 'no-cache-debug',
    } : {
      'Cache-Control': `public, max-age=${trailerSafeCacheTime}, s-maxage=${trailerSafeCacheTime}, stale-while-revalidate=${trailerSafeCacheTime}`,
      'CDN-Cache-Control': `public, s-maxage=${trailerSafeCacheTime}`,
      'Vercel-CDN-Cache-Control': `public, s-maxage=${trailerSafeCacheTime}`,
      'Netlify-Vary': 'query',
      'X-Data-Source': 'scraper-cached',
    };

    // 计算响应大小
    const responseData = JSON.stringify(details);
    const responseSize = Buffer.byteLength(responseData, 'utf8');

    // 记录成功请求
    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/douban/details',
      statusCode: 200,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: 0,
      requestSize: 0, // GET 请求通常没有 body
      responseSize: responseSize,
    });

    return NextResponse.json(details, { headers: cacheHeaders });
  } catch (error) {
    // 处理 DoubanError
    if (error instanceof DoubanError) {
      const statusCode = error.status || (
        error.code === 'TIMEOUT' ? 504 :
        error.code === 'RATE_LIMIT' ? 429 :
        error.code === 'SERVER_ERROR' ? 502 :
        500
      );

      const errorResponse = {
        code: statusCode,
        message: error.message,
        error: error.code,
        details: `获取豆瓣详情失败 (ID: ${id})`,
      };
      const errorResponseSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

      // 记录错误请求
      recordRequest({
        timestamp: startTime,
        method: 'GET',
        path: '/api/douban/details',
        statusCode,
        duration: Date.now() - startTime,
        memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: 0,
        requestSize: 0,
        responseSize: errorResponseSize,
      });

      return NextResponse.json(errorResponse,
        {
          status: statusCode,
          headers: {
            // 对于速率限制和超时，允许客户端缓存错误响应
            ...(error.code === 'RATE_LIMIT' || error.code === 'TIMEOUT' ? {
              'Cache-Control': 'public, max-age=60',
            } : {}),
          },
        }
      );
    }

    // 解析错误
    if (error instanceof Error && error.message.includes('解析')) {
      const parseErrorResponse = {
        code: 500,
        message: '解析豆瓣数据失败，可能是页面结构已变化',
        error: 'PARSE_ERROR',
        details: error.message,
      };
      const parseErrorSize = Buffer.byteLength(JSON.stringify(parseErrorResponse), 'utf8');

      recordRequest({
        timestamp: startTime,
        method: 'GET',
        path: '/api/douban/details',
        statusCode: 500,
        duration: Date.now() - startTime,
        memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: 0,
        requestSize: 0,
        responseSize: parseErrorSize,
      });

      return NextResponse.json(parseErrorResponse, { status: 500 });
    }

    // 未知错误
    const unknownErrorResponse = {
      code: 500,
      message: '获取豆瓣详情失败',
      error: 'UNKNOWN_ERROR',
      details: error instanceof Error ? error.message : '未知错误',
    };
    const unknownErrorSize = Buffer.byteLength(JSON.stringify(unknownErrorResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/douban/details',
      statusCode: 500,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: 0,
      requestSize: 0,
      responseSize: unknownErrorSize,
    });

    return NextResponse.json(unknownErrorResponse, { status: 500 });
  }
}
