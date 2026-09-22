/**
 * 地区（zone）归一化：聚合键第 4 段。未知 → ''（等价于旧行为）。
 * 来源：CMS 的 class/remarks/type_name，或豆瓣国家名。
 */
const ZONE_ALIASES: Array<{ zone: string; patterns: RegExp[] }> = [
  { zone: '大陆', patterns: [/大陆/, /内地/, /中国/i, /华语(?!.*(?:港|台))/] },
  { zone: '香港', patterns: [/香港/, /港剧/, /Hong\s?Kong/i] },
  { zone: '台湾', patterns: [/台湾/, /台剧/, /Taiwan/i] },
  { zone: '美国', patterns: [/美国/, /美剧/, /\bUS\b/, /USA/i] },
  { zone: '英国', patterns: [/英国/, /英剧/, /\bUK\b/] },
  { zone: '韩国', patterns: [/韩国/, /韩剧/, /Korea/i] },
  { zone: '日本', patterns: [/日本/, /日剧/, /动漫/, /Japan/i] },
  { zone: '泰国', patterns: [/泰国/, /泰剧/, /Thai/i] },
];

export function extractZone(...texts: Array<string | undefined>): string {
  const joined = texts.filter(Boolean).join(' ');
  if (!joined) return '';
  for (const { zone, patterns } of ZONE_ALIASES) {
    if (patterns.some((p) => p.test(joined))) return zone;
  }
  return '';
}

/** 聚合键：标题+年份+类型+地区（地区未知时退化为旧键）。 */
export function buildMatchKey(
  title: string,
  year: string | undefined,
  episodeCount: number,
  zone = '',
): string {
  const t = (title || '').replaceAll(' ', '');
  const y = year || 'unknown';
  const kind = episodeCount === 1 ? 'movie' : 'tv';
  return zone ? `${t}-${y}-${kind}-${zone}` : `${t}-${y}-${kind}`;
}
