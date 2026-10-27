import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createApiClient,
  type HttpRequestInit,
  type HttpResponseLike,
} from '../src/api/client';

function jsonResponse(status: number, body: unknown): HttpResponseLike {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function emptyResponse(status: number): HttpResponseLike {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      throw new Error('204 has no JSON body');
    },
  };
}

describe('API client', () => {
  it('unwraps the { data } envelope and sends JSON writes', async () => {
    const fetchFn = vi.fn(async (_url: string, _init: HttpRequestInit) =>
      jsonResponse(201, { data: { id: 'b1' } }),
    );
    const client = createApiClient({ fetchFn });

    const result = await client.request<{ id: string }>('POST', '/boards', {
      body: { name: '课程作业' },
    });

    expect(result).toEqual({ id: 'b1' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('/api/v1/boards');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '课程作业' }),
    });
  });

  it('returns undefined for 204 without trying to parse JSON', async () => {
    const fetchFn = vi.fn(async () => emptyResponse(204));
    const client = createApiClient({ fetchFn });

    await expect(client.request('DELETE', '/boards/b1/tasks/t1')).resolves.toBeUndefined();
  });

  it('maps a 422 to VALIDATION_ERROR with server field messages', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(422, {
        error: {
          code: 'VALIDATION_ERROR',
          message: '请检查输入内容',
          fields: { title: '标题不能为空' },
        },
      }),
    );
    const client = createApiClient({ fetchFn });

    await expect(client.request('POST', '/boards/b1/tasks', { body: {} })).rejects.toMatchObject({
      kind: 'http',
      status: 422,
      code: 'VALIDATION_ERROR',
      fields: { title: '标题不能为空' },
    });
  });

  it('maps 400/404/413/415/500/503 codes and never retries writes', async () => {
    const cases: Array<[number, string]> = [
      [400, 'BAD_REQUEST'],
      [404, 'NOT_FOUND'],
      [413, 'PAYLOAD_TOO_LARGE'],
      [415, 'UNSUPPORTED_MEDIA_TYPE'],
      [500, 'INTERNAL_ERROR'],
      [503, 'SERVICE_UNAVAILABLE'],
    ];

    for (const [status, code] of cases) {
      const fetchFn = vi.fn(async () => jsonResponse(status, {}));
      const client = createApiClient({ fetchFn });

      await expect(
        client.request('PUT', '/boards/b1/tasks/t1', { body: { title: 'x' } }),
      ).rejects.toMatchObject({ kind: 'http', status, code });

      // The write is issued exactly once: no automatic replay of PUT/POST/DELETE.
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it('falls back to a status-derived code when the error body is not the contract shape', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(415, '<html>bad</html>'));
    const client = createApiClient({ fetchFn });

    await expect(client.request('POST', '/boards', { body: {} })).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });

  it('reports a network failure without pretending it is an HTTP status', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = createApiClient({ fetchFn });

    const error = await client.request('GET', '/health').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'network', status: null, code: 'NETWORK_ERROR' });
  });

  it('times out at 10 seconds, aborts the request and does not retry', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(
        (_url: string, init: HttpRequestInit) =>
          new Promise<HttpResponseLike>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      );
      const client = createApiClient({ fetchFn });

      const pending = client.request('POST', '/boards', { body: { name: '课程作业' } });
      const assertion = expect(pending).rejects.toMatchObject({
        kind: 'timeout',
        code: 'TIMEOUT',
      });

      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a caller cancel a read and marks it as cancelled, not failed', async () => {
    const fetchFn = vi.fn(
      (_url: string, init: HttpRequestInit) =>
        new Promise<HttpResponseLike>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const client = createApiClient({ fetchFn });
    const controller = new AbortController();

    const pending = client.request('GET', '/boards/b1/tasks', {
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      kind: 'cancelled',
      code: 'CANCELLED',
    });

    controller.abort();
    await assertion;

    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isCancelled).toBe(true);
  });

  it('short-circuits an already-aborted signal', async () => {
    const fetchFn = vi.fn();
    const client = createApiClient({ fetchFn });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.request('GET', '/boards', { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});