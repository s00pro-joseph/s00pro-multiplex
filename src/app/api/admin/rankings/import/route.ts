/* eslint-disable no-console */

/**
 * 资源组(ziyuanzu.com)榜单导入器
 * 手动触发，三段式：写（3 类 × Top 3 入库）→ 测（原生真搜索检测）→ 换（死的用同榜替补换掉）
 * 字段：tier 映射到榜单来源（stable/deep/fast）
 * 匹配键：title+api 近似匹配 SourceConfig
 */

import { db } from '@/lib/db';
import { getConfig, clearConfigCache } from '@/lib/config';
import { checkSourceWithKeyword, probeSourceLiveness, DEFAULT_PROBE_KEYWORDS } from '@/lib/source-validate';
import { matchRankingToConfig } from '@/lib/source-match';

/** 导入检测用的固定探针标题：主流大片，健康源都应返回。按需更换。 */
const PROBE_KEYWORDS = DEFAULT_PROBE_KEYWORDS;

/** 疑似成人内容的名称特征（新入库时自动打标，可在面板改） */
const ADULT_NAME_HINT = /成人|黄色|情色|伦理|福利|里番|R18|xxx|porn|adult/i;

/** 用原生检测逐个试探针词：死了直接判 invalid；活着但无匹配则换下一个词 */
async function probeSource(api: string) {
  let last = await checkSourceWithKeyword(api, PROBE_KEYWORDS[0], 10000);
  if (last.status !== 'no_results') return last;
  for (let i = 1; i < PROBE_KEYWORDS.length; i++) {
    const r = await checkSourceWithKeyword(api, PROBE_KEYWORDS[i], 10000);
    if (r.status !== 'no_results') return r;
    last = r;
  }
  return last;
}

/** 每榜保留的深度：Top 3 入库，其余作替补池 */
const RANKING_POOL_DEPTH = 10;

interface ZiYuanZuRanking {
  sourceKey: string;
  sourceName: string;
  api: string;
  score: number; // 健康度/资源量综合得分
  rank: number;
  list: 'byResources' | 'bySpeed' | 'byUptime';
}

function devalueRevive(arr: any[], value: any, seen = new Map<number, any>()): any {
  if (typeof value === 'number') {
    if (seen.has(value)) return seen.get(value);
    const ref = arr[value];
    let res: any;
    if (Array.isArray(ref)) {
      res = [];
      seen.set(value, res);
      for (let i = 0; i < ref.length; i++) res[i] = devalueRevive(arr, ref[i], seen);
    } else if (ref && typeof ref === 'object') {
      res = {};
      seen.set(value, res);
      for (const [k, v] of Object.entries(ref)) (res as any)[k] = devalueRevive(arr, v, seen);
    } else {
      res = ref;
      seen.set(value, res);
    }
    return res;
  }
  if (Array.isArray(value)) return value.map((v) => devalueRevive(arr, v, seen));
  if (value && typeof value === 'object') {
    const o: any = {};
    for (const [k, v] of Object.entries(value)) o[k] = devalueRevive(arr, v, seen);
    return o;
  }
  return value;
}

async function fetchOfficialTop(): Promise<ZiYuanZuRanking[]> {
  const res = await fetch('https://www.ziyuanzu.com/top/__data.json?x-sveltekit-invalidated=01', {
    headers: { 'User-Agent': 'LunaTV-RankingImporter/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const arr: any[] = j.nodes?.[1]?.data;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('榜单数据格式异常');
  const root = devalueRevive(arr, 0) as { byResources: any[]; bySpeed: any[]; byUptime: any[] };
  const out: ZiYuanZuRanking[] = [];
  const push = (list: 'byResources' | 'bySpeed' | 'byUptime', items: any[]) => {
    // 取深一点：Top 3 入库，后面的作替补池
    (items || []).slice(0, RANKING_POOL_DEPTH).forEach((s: any, idx: number) => {
      if (!s?.api) return;
      out.push({
        sourceKey: s.api,
        sourceName: s.name || s.api,
        api: s.api,
        score: s.totalResources ?? s.responseTime ?? 0,
        rank: idx + 1,
        list,
      });
    });
  };
  push('byResources', root.byResources);
  push('bySpeed', root.bySpeed);
  push('byUptime', root.byUptime);
  if (out.length === 0) throw new Error('未解析到任何榜单数据');
  return out;
}

function mapTierByList(list: ZiYuanZuRanking['list']): 'stable' | 'deep' | 'fast' {
  // 榜单直映射：byUptime → stable, byResources → deep, bySpeed → fast
  if (list === 'byUptime') return 'stable';
  if (list === 'byResources') return 'deep';
  return 'fast';
}

function matchSourceConfig(
  rankings: ZiYuanZuRanking[],
  sourceConfig: any[]
): Array<{ source: any; tier: 'stable' | 'deep' | 'fast'; matched: boolean }> {
  const results: Array<{ source: any; tier: 'stable' | 'deep' | 'fast'; matched: boolean }> = [];

  for (const r of rankings) {
    // 四级匹配（api 精确 → key 精确 → 名称模糊 → 域名），见 lib/source-match
    const match = matchRankingToConfig(r, sourceConfig);

    const tier = mapTierByList(r.list);
    if (match) {
      results.push({
        source: match,
        tier,
        matched: true,
      });
    } else {
      results.push({
        source: {
          key: r.sourceKey,
          name: r.sourceName,
          api: r.api, // /top 自带 api，可直接入库
          from: 'custom',
          disabled: false,
          is_adult: ADULT_NAME_HINT.test(r.sourceName || ''),
        },
        tier,
        matched: false,
      });
    }
  }

  return results;
}

async function importRankings(): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  tested: number;
  pruned: number;
  replaced: Array<{ out: string; in: string; reason: string }>;
  sick: Array<{ key: string; name: string; reason: string }>;
  details: Array<{ key: string; name: string; tier: string; matched: boolean }>;
}> {
  console.log('[Rankings] 开始从资源组抓取榜单...');

  const rankings = await fetchOfficialTop();
  if (rankings.length === 0) {
    throw new Error('未解析到任何榜单数据');
  }

  // 首选：3 类 × Top 3（api 去重后 ≤9），其余同榜候选留作替补池
  const seen = new Set<string>();
  const picks: typeof rankings = [];
  const bench: typeof rankings = [];
  const perListCount = new Map<string, number>();
  for (const r of rankings) {
    if (seen.has(r.api)) continue;
    seen.add(r.api);
    const n = perListCount.get(r.list) || 0;
    perListCount.set(r.list, n + 1);
    if (n < 3) picks.push(r);
    else bench.push(r);
  }

  const config = await getConfig();
  const sourceConfig = config.SourceConfig || [];

  // —— 第一段：写 ——
  const mapped = matchSourceConfig(picks, sourceConfig);

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const details: Array<{ key: string; name: string; tier: string; matched: boolean }> = [];
  // 本轮新写入的条目（键 → 榜单来源），只换这些；老条目只报告不动
  const freshKeys = new Map<string, (typeof rankings)[number]>();

  for (const m of mapped) {
    const { source, tier: mTier, matched } = m;
    if (!matched && !source.api) {
      skipped++;
      details.push({ key: source.key, name: source.name, tier: mTier, matched: false });
      continue;
    }

    const existing = sourceConfig.find((s: any) => s.key === source.key);

    if (existing) {
      if (existing.tier !== mTier) {
        existing.tier = mTier;
        updated++;
      } else {
        skipped++;
      }
    } else {
      const entry = { ...source, tier: mTier, from: 'custom' as const, disabled: false };
      config.SourceConfig.push(entry);
      imported++;
      const rank = picks.find((r) => r.api === source.api);
      if (rank) freshKeys.set(entry.key, rank);
    }
    details.push({ key: source.key, name: source.name, tier: mTier, matched });
  }

  // —— 第二段：测 —— 先问死活（ac=list：通不通、快不快、库多大），再问覆盖（关键词：只标注不杀源）
  console.log(`[Rankings] 存活检测 ${mapped.length} 个已入库源...`);
  const liveResults = await Promise.all(
    mapped.map((m) => probeSourceLiveness(m.source.api))
  );
  const usedApis = new Set(picks.map((r) => r.api));

  // —— 第三段：换 —— 管道死的换同榜替补；本轮新写的不活才换，老条目只报告
  const replaced: Array<{ out: string; in: string; reason: string }> = [];
  const sick: Array<{ key: string; name: string; reason: string }> = [];
  const aliveApis = new Set<string>(); // 本轮确认存活的 api（收尾时清理掉出榜旧条目用）
  for (let i = 0; i < mapped.length; i++) {
    const live = liveResults[i];
    if (live.alive) continue;
    const m = mapped[i];
    const reason = live.reason || '存活检测失败';
    const rank = freshKeys.get(m.source.key);
    if (!rank) {
      // 老条目：只报告不动（面板里可手删/禁用）
      sick.push({ key: m.source.key, name: m.source.name, reason });
      console.log(`[Rankings] 老源不存活（仅报告）: ${m.source.name} (${reason})`);
      continue;
    }
    // 同榜替补按序顶上，替补同样要活着才入库
    let swapped = false;
    for (const cand of bench.filter((b) => b.list === rank.list && !usedApis.has(b.api))) {
      usedApis.add(cand.api);
      const candLive = await probeSourceLiveness(cand.api);
      if (!candLive.alive) {
        console.log(`[Rankings] 替补也不存活，继续: ${cand.sourceName} (${candLive.reason})`);
        continue;
      }
      const idx = config.SourceConfig.findIndex((s: any) => s.key === m.source.key);
      if (idx >= 0) config.SourceConfig.splice(idx, 1);
      config.SourceConfig.push({
        key: cand.api,
        name: cand.sourceName,
        api: cand.api,
        tier: mapTierByList(cand.list),
        from: 'custom' as const,
        disabled: false,
        is_adult: ADULT_NAME_HINT.test(cand.sourceName || ''),
        health: 'valid' as const, // 替补活着才入库，覆盖度随后标注
        healthCheckedAt: Date.now(),
        probeMs: candLive.ms,
        probeResources: candLive.total,
      });
      aliveApis.add(cand.api);
      imported++;
      replaced.push({ out: m.source.name, in: cand.sourceName, reason });
      console.log(`[Rankings] 已替换: ${m.source.name} → ${cand.sourceName}`);
      swapped = true;
      break;
    }
    if (!swapped) {
      sick.push({ key: m.source.key, name: m.source.name, reason: `${reason}（同榜无存活替补）` });
    }
  }

  // —— 收尾：覆盖度标注 + 检测结果落盘 + 清理掉出榜的旧条目 ——
  const now = Date.now();
  // 存活的才值得问覆盖度（关键词缺货 ≠ 管道坏，只标注）
  const coverTargets = mapped.filter((_, i) => liveResults[i].alive);
  const coverResults = await Promise.all(
    coverTargets.map((m) => probeSource(m.source.api))
  );
  coverTargets.forEach((m, j) => {
    const cov = coverResults[j];
    const entry = config.SourceConfig.find((s: any) => s.key === m.source.key);
    if (!entry) return;
    const live = liveResults[mapped.indexOf(m)];
    entry.health = cov.status; // valid = 有主流片；no_results = 活着但缺货
    entry.healthCheckedAt = now;
    delete entry.healthReason;
    entry.probeMs = live.ms;
    entry.probeResources = live.total;
    aliveApis.add(entry.api);
  });
  for (const sk of sick) {
    const entry = config.SourceConfig.find((s: any) => s.key === sk.key);
    if (!entry) continue;
    entry.health = 'invalid';
    entry.healthCheckedAt = now;
    entry.healthReason = sk.reason;
    aliveApis.add(entry.api); // 异常老源保留，面板标红由用户定夺
  }
  // 掉出榜的榜单源（custom + 有 tier + 本轮既没通过也没上报）直接清理，手动添加的（无 tier）永远不动
  const before = config.SourceConfig.length;
  config.SourceConfig = config.SourceConfig.filter((s: any) => {
    if (s.from !== 'custom' || !s.tier) return true;
    return aliveApis.has(s.api);
  });
  const pruned = before - config.SourceConfig.length;
  if (pruned > 0) console.log(`[Rankings] 清理掉出榜旧源 ${pruned} 个`);

  // 持久化
  await db.saveAdminConfig(config);
  clearConfigCache();

  console.log(`[Rankings] 完成：新增 ${imported}，更新 ${updated}，跳过 ${skipped}，检测 ${mapped.length}，替换 ${replaced.length}，异常 ${sick.length}，清理 ${pruned}`);
  return { imported, updated, skipped, tested: mapped.length, replaced, sick, pruned, details };
}

/** 手动触发入口（管理面板按钮 / cron） */
export async function GET() {
  try {
    const result = await importRankings();
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error('[Rankings] 导入失败:', error);
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';