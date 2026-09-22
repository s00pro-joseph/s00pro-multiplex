// 原子 fetch：全仓库唯一带超时的请求入口。无外部依赖，前后端共用。
// 计时从调用开始到读完包体；超时一律 AbortSignal.timeout，不留泄漏定时器。

export interface FetchResult<T> {
  ok: boolean;
  status: number;
  /** 首字节到读完包体的往返毫秒 */
  ms: number;
  data?: T;
  reason?: string;
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function timeoutReason(e: unknown, timeoutMs: number): string {
  const msg = e instanceof Error ? e.message : '请求失败';
  return /abort|timeout/i.test(msg) ? `连接超时（${timeoutMs / 1000}s）` : msg;
}

/** GET + JSON 解析。非 2xx、非 JSON、超时全部收敛为 { ok:false, reason }。 */
export async function fetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<FetchResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json, */*', ...(opts.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      return { ok: false, status: res.status, ms, reason: `HTTP ${res.status}` };
    }
    try {
      const data = (await res.json()) as T;
      return { ok: true, status: res.status, ms, data };
    } catch {
      return { ok: false, status: res.status, ms, reason: '返回不是有效 JSON（可能是 HTML 错误页）' };
    }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, reason: timeoutReason(e, timeoutMs) };
  }
}

/** GET + 纯文本（如 m3u8 播放列表、订阅文件）。 */
export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<FetchResult<string>> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, ...(opts.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      return { ok: false, status: res.status, ms, reason: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, ms, data: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, reason: timeoutReason(e, timeoutMs) };
  }
}
