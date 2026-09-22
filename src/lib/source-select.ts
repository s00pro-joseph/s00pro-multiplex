/* eslint-disable no-console */

import type { ApiSite } from '@/lib/config';
import { isSourceActive } from '@/lib/source-health';

export type SourceTier = 'stable' | 'deep' | 'fast';

const TIERS: SourceTier[] = ['stable', 'deep', 'fast'];
const PER_TIER = 3;
const MAX_ACTIVES = 9;

function weightOf(s: ApiSite): number {
  return s.weight ?? 50;
}

function tierOf(s: ApiSite): SourceTier {
  return s.tier ?? 'stable';
}

/**
 * 9-actives：每档按权重取 top-3（stable/deep/fast），不足回填补齐到 9。
 * 先过滤被健康度降级的源（含导入时落盘的 invalid）。
 * 未分档视为 stable。
 */
export function selectActiveSources(sites: ApiSite[]): ApiSite[] {
  const healthy = sites.filter((s) => s.health !== 'invalid' && isSourceActive(s.key));
  const picked: ApiSite[] = [];
  const pickedKeys = new Set<string>();

  for (const tier of TIERS) {
    const inTier = healthy
      .filter((s) => tierOf(s) === tier)
      .sort((a, b) => weightOf(b) - weightOf(a))
      .slice(0, PER_TIER);
    for (const s of inTier) {
      picked.push(s);
      pickedKeys.add(s.key);
    }
  }

  // 回填：按权重从剩余健康源补齐
  if (picked.length < MAX_ACTIVES) {
    const rest = healthy
      .filter((s) => !pickedKeys.has(s.key))
      .sort((a, b) => weightOf(b) - weightOf(a));
    for (const s of rest) {
      if (picked.length >= MAX_ACTIVES) break;
      picked.push(s);
      pickedKeys.add(s.key);
    }
  }

  return picked;
}

/**
 * 库越大越优先（未知放最后，权重兜底）：搜索 fan-out 与结果排序共用。
 * 选“谁上场”仍由 selectActiveSources 定，这里只定“谁先上场”。
 */
export function sortByResourcesDesc<T extends { probeResources?: number; weight?: number }>(
  sites: T[]
): T[] {
  return [...sites].sort((a, b) => {
    const sizeDiff = (b.probeResources ?? -1) - (a.probeResources ?? -1);
    if (sizeDiff !== 0) return sizeDiff;
    return (b.weight ?? 50) - (a.weight ?? 50);
  });
}

/** 调试/展示用：每档入选 key。 */
export function describeSelection(sites: ApiSite[]): Record<SourceTier, string[]> {
  const active = selectActiveSources(sites);
  const out: Record<SourceTier, string[]> = { stable: [], deep: [], fast: [] };
  for (const s of active) out[tierOf(s)].push(s.key);
  return out;
}
