// 纯函数：由存储地址算出经 Worker 后的实际生效地址。无外部依赖，前后端共用。
// 后端 applyVideoProxy 与管理页“生效地址”展示都走这里，两边永远一致。

/** 去掉已有的 ?url= 代理包装，还原真实上游地址 */
export function stripProxiedUrl(api: string): string {
  const m = api.match(/[?&]url=([^&]+)/);
  if (!m) return api;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return api;
  }
}

/** 由上游地址生成 per-source 路径 id（与 Worker 端 /p/{id} 对应） */
export function extractSourceId(apiUrl: string, fallback = 'source'): string {
  try {
    const url = new URL(apiUrl);
    const parts = url.hostname.split('.');
    if (
      parts.length >= 3 &&
      (parts[0] === 'caiji' || parts[0] === 'api' || parts[0] === 'cj' || parts[0] === 'www')
    ) {
      return parts[parts.length - 2].toLowerCase().replace(/[^a-z0-9]/g, '') || fallback;
    }
    const name = parts[0]
      .toLowerCase()
      .replace(/zyapi$/, '')
      .replace(/zy$/, '')
      .replace(/api$/, '');
    return name.replace(/[^a-z0-9]/g, '') || fallback;
  } catch {
    return fallback;
  }
}

/** 算出该源实际生效的请求地址（代理开启时走 Worker /p/ 路径） */
export function buildProxiedApiUrl(api: string, proxyBaseUrl: string, key = ''): string {
  const realApiUrl = stripProxiedUrl(api);
  const base = proxyBaseUrl.replace(/\/$/, '');
  const sourceId = extractSourceId(realApiUrl, key || 'source');
  return `${base}/p/${sourceId}?url=${encodeURIComponent(realApiUrl)}`;
}
