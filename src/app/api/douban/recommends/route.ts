/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { DoubanResult } from '@/lib/types';
import { recordRequest } from '@/lib/performance-monitor';

interface DoubanRecommendApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    year: string;
    type: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  const { searchParams } = new URL(request.url);

  // 获取参数
  const kind = searchParams.get('kind');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');
  const category =
    searchParams.get('category') === 'all' ? '' : searchParams.get('category');
  const format =
    searchParams.get('format') === 'all' ? '' : searchParams.get('format');
  const region =
    searchParams.get('region') === 'all' ? '' : searchParams.get('region');
  const year =
    searchParams.get('year') === 'all' ? '' : searchParams.get('year');
  const platform =
    searchParams.get('platform') === 'all' ? '' : searchParams.get('platform');
  const sort = searchParams.get('sort') || '';
  const label =
    searchParams.get('label') === 'all' ? '' : searchParams.get('label');

  if (!kind) {
    const errorResponse = { error: '缺少必要参数: kind' };
    const errorSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/douban/recommends',
      statusCode: 400,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: 0,
      requestSize: 0,
      responseSize: errorSize,
    });

    return NextResponse.json(errorResponse, { status: 400 });
  }

  const selectedCategories = { 类型: category } as any;
  if (format) {
    selectedCategories['形式'] = format;
  }
  if (region) {
    selectedCategories['地区'] = region;
  }

  const tags = [] as Array<string>;
  if (category) {
    tags.push(category);
  }
  if (!category && format) {
    tags.push(format);
  }
  if (label) {
    tags.push(label);
  }
  if (region) {
    tags.push(region);
  }
  if (year) {
    tags.push(year);
  }
  if (platform) {
    tags.push(platform);
  }

  const baseUrl = `https://m.douban.com/rexxar/api/v2/${kind}/recommend`;
  const params = new URLSearchParams();
  params.append('refresh', '0');
  params.append('start', pageStart.toString());
  params.append('count', pageLimit.toString());
  if (category || format || region) {
    params.append('selected_categories', JSON.stringify(selectedCategories));
  }
  params.append('uncollect', 'false');
  params.append('score_range', '0,10');
  if (tags.length > 0) {
    params.append('tags', tags.join(','));
  }
  if (sort) {
    params.append('sort', sort);
  }

  const target = `${baseUrl}?${params.toString()}`;
  console.log(target);
  try {
    // 豆瓣在无筛选条件时每页经常返回不足 count 的条数，这里聚合多页直到填满
    // pageLimit（最多尝试 6 次），避免前端误判“已加载全部”。
    const collected: DoubanRecommendApiResponse['items'] = [];
    const seenIds = new Set<string>();
    let fetchStart = pageStart;
    for (let attempt = 0; attempt < 6 && collected.length < pageLimit; attempt += 1) {
      const pagedParams = new URLSearchParams(params);
      pagedParams.set('start', fetchStart.toString());
      const batch = await fetchDoubanData<DoubanRecommendApiResponse>(
        `${baseUrl}?${pagedParams.toString()}`
      );
      const items = batch.items ?? [];
      if (items.length === 0) {
        break;
      }
      for (const item of items) {
        if (item?.id && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          collected.push(item);
        }
      }
      fetchStart += items.length;
    }
    const list = collected
      .filter((item) => (item.type == 'movie' || item.type == 'tv') && item.id && item.title)
      .slice(0, pageLimit)
      .map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.pic?.normal || item.pic?.large || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.year,
      }));
    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: list,
      nextStart: fetchStart,
    };

    const responseSize = Buffer.byteLength(JSON.stringify(response), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/douban/recommends',
      statusCode: 200,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: 0,
      requestSize: 0,
      responseSize,
    });

    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    const errorResponse = { error: '获取豆瓣数据失败', details: (error as Error).message };
    const errorSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/douban/recommends',
      statusCode: 500,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: 0,
      requestSize: 0,
      responseSize: errorSize,
    });

    return NextResponse.json(errorResponse, { status: 500 });
  }
}
