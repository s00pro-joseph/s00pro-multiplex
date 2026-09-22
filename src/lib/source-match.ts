// 来源匹配：全仓库唯一的“找源 / 找条目”逻辑。无外部依赖，前后端共用。
// 调用方：榜单导入（api/key/名称/域名四级匹配）、详情与播放（key 精确 + 条目精确）。

export interface MatchableSite {
  key: string;
  name: string;
  api: string;
}

export interface MatchableResult {
  source: string | number;
  id: string | number;
}

/** 1. 站点精确匹配：按 key。找不到抛错由调用方决定。 */
export function findSiteByKey<T extends MatchableSite>(
  sites: T[],
  key: string
): T | undefined {
  return sites.find((s) => s.key === key);
}

/** 2. 条目精确匹配：同源同 id（转字符串比，避免数字/字符串混用）。 */
export function findResultBySourceId<T extends MatchableResult>(
  results: T[],
  source: string | number,
  id: string | number
): T | undefined {
  return results.find(
    (item) =>
      item.source?.toString() === source?.toString() &&
      item.id?.toString() === id?.toString()
  );
}

/** 3. 域名提取（匹配用）：只要 host 部分，不做 id 化。 */
export function domainOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
}

export interface RankingCandidate {
  sourceKey: string;
  sourceName: string;
  api: string;
}

/**
 * 4. 榜单候选 → 已有配置的四级匹配（按可靠度降序）：
 *    api 精确 → key 精确 → 名称包含（双向）→ api 域名包含。
 *    返回匹配到的条目；调用方自行决定新建形状。
 */
export function matchRankingToConfig<T extends MatchableSite>(
  candidate: RankingCandidate,
  sourceConfig: T[]
): T | undefined {
  if (candidate.api) {
    const byApi = sourceConfig.find((s) => s.api === candidate.api);
    if (byApi) return byApi;
  }
  const byKey = sourceConfig.find((s) => s.key === candidate.sourceKey);
  if (byKey) return byKey;
  const byName = sourceConfig.find(
    (s) =>
      s.name === candidate.sourceName ||
      (candidate.sourceName && s.name.includes(candidate.sourceName)) ||
      (s.name && candidate.sourceName.includes(s.name))
  );
  if (byName) return byName;
  if (candidate.api) {
    const domain = domainOf(candidate.api);
    if (domain) {
      const byDomain = sourceConfig.find((s) => s.api?.includes(domain));
      if (byDomain) return byDomain;
    }
  }
  return undefined;
}
