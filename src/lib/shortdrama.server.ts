/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { getConfig } from './config';
import { parseWithAlternativeApi } from './shortdrama.client';
import { DEFAULT_USER_AGENT } from './user-agent';
import { ShortDramaItem, ShortDramaParseResult } from './types';

// 短剧相关分类关键词（父分类 + 子分类标签）
const SHORT_DRAMA_KEYWORDS = ['短剧', '女频恋爱', '反转爽剧', '古装仙侠', '年代穿越', '脑洞悬疑', '现代都市'];

// 从单个短剧源获取数据（通过分类名称查找）
async function fetchFromShortDramaSource(
  api: string,
  size: number
): Promise<ShortDramaItem[]> {
  // Step 1: 获取分类列表，找到短剧相关分类的ID
  const listUrl = `${api}?ac=list`;

  const listResponse = await fetch(listUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!listResponse.ok) {
    throw new Error(`HTTP error! status: ${listResponse.status}`);
  }

  const listData = await listResponse.json();
  const categories = listData.class || [];

  // 查找短剧相关分类（父分类"短剧"或子分类标签）
  const shortDramaCategories = categories.filter((cat: any) =>
    cat.type_name && SHORT_DRAMA_KEYWORDS.some((kw: string) => cat.type_name.includes(kw))
  );

  if (shortDramaCategories.length === 0) {
    console.log(`该源没有短剧分类`);
    return [];
  }

  // 优先用父分类"短剧"，没有则用第一个匹配的子分类
  const primaryCategory = shortDramaCategories.find((cat: any) => cat.type_name === '短剧')
    || shortDramaCategories[0];
  const categoryId = primaryCategory.type_id;
  console.log(`找到短剧分类ID: ${categoryId} (${primaryCategory.type_name})`);

  // Step 2: 获取该分类的短剧列表
  const apiUrl = `${api}?ac=detail&t=${categoryId}&pg=1`;

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const items = data.list || [];

  return items.slice(0, size).map((item: any) => ({
    id: item.vod_id,
    name: item.vod_name,
    cover: item.vod_pic || '',
    update_time: item.vod_time || new Date().toISOString(),
    score: parseFloat(item.vod_score) || 0,
    episode_count: parseInt(item.vod_remarks?.replace(/[^\d]/g, '') || '1'),
    description: item.vod_content || item.vod_blurb || '',
    author: item.vod_actor || '',
    backdrop: item.vod_pic_slide || item.vod_pic || '',
    vote_average: parseFloat(item.vod_score) || 0,
  }));
}

// 服务端专用函数，从所有短剧源聚合数据
export async function getRecommendedShortDramas(
  category?: number,
  size = 10
): Promise<ShortDramaItem[]> {
  try {
    // 获取配置
    const config = await getConfig();

    // 筛选出所有启用的短剧源
    const shortDramaSources = config.SourceConfig.filter(
      source => source.type === 'shortdrama' && !source.disabled
    );

    console.log(`📺 找到 ${shortDramaSources.length} 个配置的短剧源`);

    // 如果没有配置短剧源，使用默认源
    if (shortDramaSources.length === 0) {
      console.log('📺 使用默认短剧源');
      return await fetchFromShortDramaSource(
        'https://tyyszyapi.com/api.php/provide/vod',
        size
      );
    }

    // 有配置短剧源，聚合所有源的数据
    console.log('📺 聚合多个短剧源的数据');
    const results = await Promise.allSettled(
      shortDramaSources.map(source => {
        console.log(`🔄 请求短剧源: ${source.name}`);
        return fetchFromShortDramaSource(source.api, size);
      })
    );

    // 合并所有成功的结果
    const allItems: ShortDramaItem[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        console.log(`✅ ${shortDramaSources[index].name}: 获取到 ${result.value.length} 条数据`);
        allItems.push(...result.value);
      } else {
        console.error(`❌ ${shortDramaSources[index].name}: 请求失败`, result.reason);
      }
    });

    // 去重（根据名称）
    const uniqueItems = Array.from(
      new Map(allItems.map(item => [item.name, item])).values()
    );

    // 按更新时间排序
    uniqueItems.sort((a, b) =>
      new Date(b.update_time).getTime() - new Date(a.update_time).getTime()
    );

    // 返回指定数量
    const finalItems = uniqueItems.slice(0, size);
    console.log(`📊 最终返回 ${finalItems.length} 条短剧数据`);

    return finalItems;
  } catch (error) {
    console.error('获取短剧推荐失败:', error);
    // 出错时fallback到默认源
    try {
      console.log('⚠️ 出错，fallback到默认源');
      return await fetchFromShortDramaSource(
        'https://tyyszyapi.com/api.php/provide/vod',
        size
      );
    } catch (fallbackError) {
      console.error('默认源也失败:', fallbackError);
      return [];
    }
  }
}

// 默认主API地址（与配置缺省值保持一致）
const DEFAULT_PRIMARY_API = 'https://tyyszyapi.com/api.php/provide/vod';

// 从上游 vod 接口直取单集播放地址（服务端专用）
// parseShortDramaEpisode（client 版）内部用相对路径回調 /api/shortdrama/parse，
// 在服务端 fetch 相对 URL 会直接抛 ERR_INVALID_URL，因此路由层改调本函数
async function fetchPrimaryEpisodeUrl(
  apiBase: string,
  id: number,
  episode: number
): Promise<ShortDramaParseResult> {
  const detailUrl = `${apiBase}?ac=videolist&ids=${id}`;

  const response = await fetch(detailUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const item = data?.list?.[0];

  if (!item) {
    return { code: 1, msg: '未找到该短剧' };
  }

  // vod_play_url 格式: 分组($$$分隔) > 分集(#分隔) > 标题$地址
  const firstGroup = String(item.vod_play_url || '').split('$$$')[0] || '';
  const segments = firstGroup.split('#').filter(Boolean);

  if (segments.length === 0) {
    return { code: 1, msg: '该短剧暂无可用播放地址' };
  }

  // episode<=1 取第1集，其余按 episode-1 取索引，并做越界保护
  const index =
    episode <= 1 ? 0 : Math.min(episode - 1, segments.length - 1);
  const segment = segments[index];
  const url = segment.slice(segment.lastIndexOf('$') + 1).trim();

  if (!url) {
    return { code: 1, msg: '该集暂时无法播放，请稍后再试' };
  }

  const parsedUrl = url.replace(/^http:\/\//i, 'https://');
  const proxyUrl = `/api/proxy/shortdrama?url=${encodeURIComponent(parsedUrl)}`;
  const currentEpisode = index + 1;

  return {
    code: 0,
    data: {
      videoId: item.vod_id ?? id,
      videoName: item.vod_name || '',
      currentEpisode,
      totalEpisodes: segments.length,
      parsedUrl,
      proxyUrl,
      cover: item.vod_pic || '',
      description: item.vod_content || item.vod_blurb || '',
      episode: {
        index: currentEpisode,
        label: `第${currentEpisode}集`,
        parsedUrl,
        proxyUrl,
        title: `第${currentEpisode}集`,
      },
    },
  };
}

// 服务端解析单集（供 /api/shortdrama/parse 与 /detail 路由调用）
// 保持与 client 版一致的 fallback 顺序：备用API优先（若提供）→ 主API → 备用API兜底
export async function parseShortDramaEpisodeServer(
  id: number,
  episode: number,
  useProxy = true,
  dramaName?: string,
  alternativeApiUrl?: string
): Promise<ShortDramaParseResult> {
  if (dramaName && alternativeApiUrl) {
    console.log('优先尝试备用API...');
    try {
      const alternativeResult = await parseWithAlternativeApi(
        dramaName,
        episode,
        alternativeApiUrl
      );
      if (alternativeResult.code === 0) {
        console.log('备用API成功！');
        return alternativeResult;
      }
      console.log('备用API失败，fallback到主API:', alternativeResult.msg);
    } catch (altError) {
      console.log('备用API错误，fallback到主API:', altError);
    }
  }

  try {
    let primaryApiUrl = DEFAULT_PRIMARY_API;
    try {
      const config = await getConfig();
      primaryApiUrl =
        config.ShortDramaConfig?.primaryApiUrl || DEFAULT_PRIMARY_API;
    } catch (configError) {
      console.error('读取短剧主API配置失败，使用默认源:', configError);
    }

    const result = await fetchPrimaryEpisodeUrl(primaryApiUrl, id, episode);

    if (result.code !== 0) {
      if (dramaName && alternativeApiUrl) {
        console.log('主API失败，尝试使用备用API...');
        return await parseWithAlternativeApi(dramaName, episode, alternativeApiUrl);
      }
      return result;
    }

    if (!useProxy && result.data) {
      result.data.proxyUrl = result.data.parsedUrl;
      if (result.data.episode) {
        result.data.episode.proxyUrl = result.data.parsedUrl;
      }
    }

    return result;
  } catch (error) {
    console.error('服务端解析短剧集数失败:', error);
    if (dramaName && alternativeApiUrl) {
      console.log('主API网络错误，尝试使用备用API...');
      return await parseWithAlternativeApi(dramaName, episode, alternativeApiUrl);
    }
    return {
      code: -1,
      msg: '网络连接失败，请检查网络后重试',
    };
  }
}
