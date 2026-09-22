/* eslint-disable no-console */
import { fetchFirst } from '@/lib/fetch-chain';
import type { SearchResult } from '@/lib/types';

/**
 * 豆瓣联想锚点（轻量）：subject_suggest 取前 8，作为元数据锚点与 CMS 结果合并。
 * 锚点无可播集数，只带标题/年份/豆瓣ID/海报；聚合时与同名 CMS 结果并入同一卡片。
 */
export async function fetchDoubanAnchors(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    // 直连优先，备用 host 兜底
    const path = `/j/subject_suggest?q=${encodeURIComponent(q)}`;
    const { res } = await fetchFirst(
      [`https://movie.douban.com${path}`, `https://m.douban.com${path}`],
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Referer: 'https://movie.douban.com/',
          Accept: 'application/json',
        },
        timeoutMs: 5000,
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (item: any) =>
          item && item.id && item.title && (item.type === 'movie' || item.type === 'tv' || !item.type),
      )
      .slice(0, 8)
      .map((item: any) => ({
        id: `douban-${item.id}`,
        title: String(item.title).trim().replace(/\s+/g, ' '),
        poster: item.img || '',
        episodes: [] as string[],
        episodes_titles: [] as string[],
        source: 'douban',
        source_name: '豆瓣',
        year: item.year ? String(item.year).match(/\d{4}/)?.[0] || '' : '',
        douban_id: Number(item.id) || undefined,
        type_name: item.type === 'tv' ? '电视剧' : '电影',
      })) as SearchResult[];
  } catch {
    return [];
  }
}
