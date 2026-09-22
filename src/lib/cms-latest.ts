/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { ApiSite } from '@/lib/config';
import { SearchResult } from '@/lib/types';

/**
 * CMS 片库浏览：?ac=videolist&pg=（无 wd = 最新入库）
 * 给海报墙用，与豆瓣货架合并，轻松破 100。
 */

interface CmsListItem {
  vod_id: string | number;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_play_url?: string;
  vod_douban_id?: number;
  type_name?: string;
}

function countEpisodes(playUrl?: string): number {
  if (!playUrl) return 1;
  // 粗略集数：# 分隔的分集数，至少 1
  const groups = playUrl.split('$$$');
  let best = 0;
  for (const g of groups) {
    const n = g.split('#').filter((s) => s.trim()).length;
    if (n > best) best = n;
  }
  return Math.max(1, best);
}

export async function fetchCmsLatestPage(
  site: ApiSite,
  page: number,
  timeoutMs = 10000,
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${site.api}?ac=videolist&pg=${page}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return [];
    const data = await res.json();
    const list: CmsListItem[] = Array.isArray(data?.list) ? data.list : [];
    return list
      .filter((i) => i && i.vod_name)
      .map((i) => {
        const eps = countEpisodes(i.vod_play_url);
        return {
          id: String(i.vod_id),
          title: String(i.vod_name).trim(),
          poster: (i.vod_pic || '').trim(),
          episodes: Array.from({ length: eps }, (_, k) => `第${k + 1}集`),
          episodes_titles: [],
          source: site.key,
          source_name: site.name,
          class: i.vod_class,
          year: i.vod_year?.match(/\d{4}/)?.[0] || 'unknown',
          type_name: i.type_name,
          douban_id: i.vod_douban_id,
          remarks: i.vod_remarks,
        } as SearchResult;
      });
  } catch {
    clearTimeout(timeoutId);
    return [];
  }
}
