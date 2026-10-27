import type { ApiErrorEnvelope, ApiSuccess } from '@team-plan/shared';
import { asRequestError, RequestError, type BoardApi, type ReadOptions } from './service';

export function createHttpApi(fetcher: typeof fetch = (...args) => fetch(...args), timeoutMs = 10_000): BoardApi {
  async function request<T>(path: string, options: ReadOptions & { body?: unknown } = {}): Promise<T> {
    if (options.signal?.aborted) throw new RequestError('aborted', 'ABORTED');
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new RequestError(timedOut ? 'timeout' : 'aborted', timedOut ? 'TIMEOUT' : 'ABORTED'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    try {
      return await Promise.race([aborted, (async () => {
        const response = await fetcher(`/api/v1${path}`, {
          method: options.body === undefined ? 'GET' : 'POST',
          headers: options.body === undefined ? { Accept: 'application/json' } : {
            Accept: 'application/json', 'Content-Type': 'application/json',
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal, cache: 'no-store',
        });
        if (response.status === 204 && response.ok) return undefined as T;
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const error = (body as Partial<ApiErrorEnvelope> | null)?.error;
          const code = typeof error?.code === 'string' ? error.code : 'HTTP_ERROR';
          const fields = error?.fields && typeof error.fields === 'object'
            ? Object.fromEntries(Object.entries(error.fields).filter(([, value]) => typeof value === 'string')) : undefined;
          throw new RequestError('http', code, response.status, fields);
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'data')) {
          throw new RequestError('contract', 'INVALID_RESPONSE');
        }
        return (body as ApiSuccess<T>).data;
      })()]);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RequestError(timedOut ? 'timeout' : 'aborted', timedOut ? 'TIMEOUT' : 'ABORTED');
      }
      throw asRequestError(error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', rejectAbort);
    }
  }
  const segment = encodeURIComponent;
  return {
    health: options => request('/health', options),
    listBoards: options => request('/boards', options),
    createBoard: input => request('/boards', { body: input }),
    createTask: (id, input) => request(`/boards/${segment(id)}/tasks`, { body: input }),
    getBoard: (id, options) => request(`/boards/${segment(id)}`, options),
    listMembers: options => request('/members', options),
    listTasks: (id, options) => request(`/boards/${segment(id)}/tasks`, options),
    getTask: (id, taskId, options) => request(`/boards/${segment(id)}/tasks/${segment(taskId)}`, options),
  };
}
