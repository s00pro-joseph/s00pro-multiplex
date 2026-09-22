/* eslint-disable no-console */

/**
 * 视频源健康度（内存版，重启清零）。
 * 规则：
 * - 仅连续 3 次硬失败才降级（搜索时跳过）。
 * - 401/403/超时/慢从不降级（记 exempt，不计数）。
 * - 降级 5 分钟后自动半开：放行一次试探，成功即恢复。
 * - 探测只发廉价请求（无意义关键词，命中空列表），不做全量拉取。
 * - 网络层统一走 lib/fetch（唯一的超时入口）。
 */

import { fetchJson } from '@/lib/fetch';

export type HealthOutcome = 'ok' | 'hard-fail' | 'exempt';

const HARD_FAIL_THRESHOLD = 3;
const REPROBE_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8000;

interface SourceHealth {
  consecutiveHardFails: number;
  demotedAt: number | null;
  lastOkAt: number | null;
}

const healthMap = new Map<string, SourceHealth>();

function getHealth(key: string): SourceHealth {
  let h = healthMap.get(key);
  if (!h) {
    h = { consecutiveHardFails: 0, demotedAt: null, lastOkAt: null };
    healthMap.set(key, h);
  }
  return h;
}

/** 按 HTTP 状态/错误类型归类：401/403/超时一律 exempt，只有真故障才计数。 */
export function classifyFetchResult(status?: number, error?: unknown): HealthOutcome {
  if (typeof status === 'number') {
    if (status >= 200 && status < 300) return 'ok';
    if (status === 401 || status === 403) return 'exempt';
    if (status === 408 || status === 429) return 'exempt';
    if (status >= 500) return 'hard-fail';
    // 4xx 其他：源拒绝该请求但服务活着，不降级
    return 'exempt';
  }
  if (error instanceof Error) {
    const msg = (error.message || '').toLowerCase();
    if (
      msg.includes('abort') ||
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      (error as any)?.name === 'AbortError' ||
      (error as any)?.code === 'ECONNABORTED'
    ) {
      return 'exempt';
    }
  }
  return 'hard-fail';
}

export function recordSourceResult(key: string, outcome: HealthOutcome): void {
  const h = getHealth(key);
  if (outcome === 'ok') {
    h.consecutiveHardFails = 0;
    h.demotedAt = null;
    h.lastOkAt = Date.now();
    return;
  }
  if (outcome === 'exempt') return; // 慢/401/403：不计数
  h.consecutiveHardFails += 1;
  if (h.consecutiveHardFails >= HARD_FAIL_THRESHOLD && h.demotedAt === null) {
    h.demotedAt = Date.now();
    console.warn(`[SourceHealth] 源 ${key} 连续 ${h.consecutiveHardFails} 次硬失败，已降级（5 分钟后自动试探恢复）`);
  }
}

/** 搜索前调用：被降级且未到试探时间 → 跳过。 */
export function isSourceActive(key: string): boolean {
  const h = healthMap.get(key);
  if (!h || h.demotedAt === null) return true;
  if (Date.now() - h.demotedAt >= REPROBE_MS) {
    // 半开：放行一次试探（成功清零，失败重新计时）
    h.demotedAt = Date.now();
    h.consecutiveHardFails = HARD_FAIL_THRESHOLD - 1;
    return true;
  }
  return false;
}

/** 廉价探测：无意义关键词，期望空列表；超时=慢，不降级。底层走唯一的 fetch 入口。 */
export async function probeSource(api: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<HealthOutcome> {
  const sep = api.includes('?') ? '&' : '?';
  const r = await fetchJson(`${api}${sep}ac=videolist&wd=__probe__`, { timeoutMs });
  if (r.ok) return 'ok';
  if (r.reason?.startsWith('HTTP')) {
    return classifyFetchResult(Number(r.reason.slice(5)) || undefined);
  }
  // 超时/断连：沿用 exempt 语义（慢从不降级）
  return classifyFetchResult(undefined, new Error('timeout'));
}

/** 管理/调试用快照。 */
export function getHealthSnapshot(): Record<string, { fails: number; demoted: boolean; lastOkAt: number | null }> {
  const out: Record<string, { fails: number; demoted: boolean; lastOkAt: number | null }> = {};
  healthMap.forEach((h, key) => {
    out[key] = { fails: h.consecutiveHardFails, demoted: h.demotedAt !== null, lastOkAt: h.lastOkAt };
  });
  return out;
}
