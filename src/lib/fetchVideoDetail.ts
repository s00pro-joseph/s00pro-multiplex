import { getAvailableApiSites } from '@/lib/config';
import { SearchResult } from '@/lib/types';

import { getDetailFromApi, searchFromApi } from './downstream';
import { findResultBySourceId, findSiteByKey } from '@/lib/source-match';

interface FetchVideoDetailOptions {
  source: string;
  id: string;
  fallbackTitle?: string;
}

/**
 * 根据 source 与 id 获取视频详情。
 * 1. 若传入 fallbackTitle，则先调用 /api/search 搜索精确匹配。
 * 2. 若搜索未命中或未提供 fallbackTitle，则直接调用 /api/detail。
 */
export async function fetchVideoDetail({
  source,
  id,
  fallbackTitle = '',
}: FetchVideoDetailOptions): Promise<SearchResult> {
  // 优先通过搜索接口查找精确匹配
  const apiSites = await getAvailableApiSites();
  const apiSite = findSiteByKey(apiSites, source);
  if (!apiSite) {
    throw new Error('无效的API来源');
  }
  if (fallbackTitle) {
    try {
      const searchData = await searchFromApi(apiSite, fallbackTitle.trim());
      const exactMatch = findResultBySourceId(searchData, source, id);
      if (exactMatch) {
        return exactMatch;
      }
    } catch (error) {
      // do nothing
    }
  }

  // 调用 /api/detail 接口
  const detail = await getDetailFromApi(apiSite, id);
  if (!detail) {
    throw new Error('获取视频详情失败');
  }

  return detail;
}
