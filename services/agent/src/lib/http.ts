/** A non-2xx answer from an upstream service. The message never includes the query string. */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    target: string,
  ) {
    super(`${target} answered ${status}`);
  }
}

/** Host and path only: query strings can carry API keys and must not reach logs. */
function describe(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'upstream';
  }
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

/** `fetch` with a hard timeout. Throws `UpstreamError` on a non-2xx status. */
export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { timeoutMs = 8_000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new UpstreamError(response.status, body.slice(0, 500), describe(url));
    }
    return response;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    const reason = controller.signal.aborted ? 'timed out' : 'failed';
    throw new Error(`${describe(url)} ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJson(url: string, options: RequestOptions = {}): Promise<unknown> {
  const response = await request(url, options);
  return response.json();
}

export function postJson(url: string, body: unknown, options: RequestOptions = {}) {
  return requestJson(url, {
    ...options,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

/** Rejects with `Error('timeout')` when `promise` takes longer than `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
