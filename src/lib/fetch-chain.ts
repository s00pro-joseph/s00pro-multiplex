/* eslint-disable no-console */

/**
 * 有序回退链（direct first）：按顺序试 URL，首个 ok 即返回。
 * 401/403/timeout 不换链（调用方按源健康度规则处理）。
 */
export interface ChainResult {
  res: Response;
  url: string;
  index: number;
}

export async function fetchFirst(
  urls: string[],
  init?: RequestInit & { timeoutMs?: number },
): Promise<ChainResult> {
  const { timeoutMs = 8000, ...fetchInit } = init || {};
  let lastError: unknown = null;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...fetchInit, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return { res, url, index: i };
      lastError = new Error(`HTTP ${res.status} from ${url}`);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('fallback chain exhausted');
}

/** 豆瓣 API 链：直连优先，统一 CDN 兜底。 */
export function doubanApiChain(path: string): string[] {
  const p = path.startsWith('/') ? path : `/${path}`;
  return [
    `https://m.douban.com${p}`,
    `https://img.doubanio.cmliussss.net${p}`,
  ];
}
