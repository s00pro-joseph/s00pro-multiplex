/* eslint-disable no-console */
// 原生源检测：所有调用方共用这一个。底层走唯一的 fetch 入口（lib/fetch）。
// 调用方：管理页有效性检测（流式展示）/ 榜单导入 routine / 运行时健康跟踪。

import { API_CONFIG } from '@/lib/config';
import { fetchJson } from '@/lib/fetch';
import { DEFAULT_PROBE_KEYWORDS } from '@/lib/probe-keywords';

export { DEFAULT_PROBE_KEYWORDS };

export type SourceCheckStatus = 'valid' | 'no_results' | 'invalid';

export interface LivenessResult {
  /** 管道活着：ac=list 正常返回 */
  alive: boolean;
  /** 首包往返毫秒（稳定性+速度的度量） */
  ms: number;
  /** 全库总量（ac=list 的 total，搜索排序用：越大越优先） */
  total: number;
  reason?: string;
}

/**
 * 存活检测：只问“管道通不通、快不快、库多大”，不问“有没有某部片”。
 * 关键词缺货 ≠ 管道坏 —— 覆盖问题由 checkSourceWithKeyword 另行标注，永不杀源。
 */
export async function probeSourceLiveness(
  apiBaseUrl: string,
  timeoutMs = 10000
): Promise<LivenessResult> {
  const sep = apiBaseUrl.includes('?') ? '&' : '?';
  const r = await fetchJson<any>(`${apiBaseUrl}${sep}ac=list`, { timeoutMs });
  if (!r.ok || !r.data) {
    return { alive: false, ms: r.ms, total: 0, reason: r.reason };
  }
  const list = r.data?.list;
  if (!Array.isArray(list)) {
    return { alive: false, ms: r.ms, total: 0, reason: '响应无 list 字段' };
  }
  const total = typeof r.data.total === 'number' ? r.data.total : list.length;
  return { alive: true, ms: r.ms, total };
}

export interface SourceCheckResult {
  status: SourceCheckStatus;
  ms: number;
  reason?: string;
}

/** 对单个 API 基地址做一次真搜索检测。reachable 但无匹配标题 = no_results（活着）。 */
export async function checkSourceWithKeyword(
  apiBaseUrl: string,
  keyword: string,
  timeoutMs = 10000
): Promise<SourceCheckResult> {
  const sep = apiBaseUrl.includes('?') ? '&' : '?';
  const url = `${apiBaseUrl}${sep}ac=videolist&wd=${encodeURIComponent(keyword)}`;
  const r = await fetchJson<any>(url, { timeoutMs, headers: API_CONFIG.search.headers });
  if (!r.ok || !r.data) {
    return { status: 'invalid', ms: r.ms, reason: r.reason };
  }
  const list = r.data?.list;
  if (!Array.isArray(list) || list.length === 0) {
    return { status: 'no_results', ms: r.ms };
  }
  const hit = list.some((item: any) =>
    ((item?.vod_name as string) || '').toLowerCase().includes(keyword.toLowerCase())
  );
  return { status: hit ? 'valid' : 'no_results', ms: r.ms };
}
