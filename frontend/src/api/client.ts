import {
  ERROR_MESSAGES,
  type ApiErrorBody,
  type CreateBoardInput,
  type ErrorCode,
  type TaskFieldInput,
} from '@team-plan/shared';

/** Client-side timeout; it only ends local waiting, never cancels a committed write. */
export const REQUEST_TIMEOUT_MS = 10_000;

export type ApiFailureKind = 'http' | 'timeout' | 'network' | 'cancelled';

export interface HttpResponseLike {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

export interface HttpRequestInit {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init: HttpRequestInit) => Promise<HttpResponseLike>;

export interface ApiClientOptions {
  fetchFn?: FetchLike;
  timeoutMs?: number;
  basePath?: string;
}

/**
 * One uniform failure type. `code` mirrors the server error-code table; local
 * network/timeout/cancel failures get their own codes and never pretend to be
 * an HTTP status. The UI maps messages by `code`, not by server `message`.
 */
export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | null;
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELLED';
  readonly fields?: Record<string, string>;

  constructor(options: {
    kind: ApiFailureKind;
    status?: number | null;
    code: ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELLED';
    fields?: Record<string, string>;
    message?: string;
  }) {
    super(options.message ?? ERROR_MESSAGES[options.code as ErrorCode] ?? '请求失败');
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.code = options.code;
    this.fields = options.fields;
  }

  get isCancelled(): boolean {
    return this.kind === 'cancelled';
  }
}

export interface ApiClient {
  request<T>(method: string, path: string, options?: {
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<T>;
  readonly timeoutMs: number;
}

const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
  return {
    status: response.status,
    ok: response.ok,
    json: () => response.json(),
  };
};

/** Keep the error code meaningful even when the server body is malformed. */
function fallbackCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'EDITOR_KEY_REQUIRED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 405:
      return 'METHOD_NOT_ALLOWED';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 422:
      return 'VALIDATION_ERROR';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

function parseErrorBody(body: unknown): ApiErrorBody | null {
  if (body === null || typeof body !== 'object') {
    return null;
  }
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') {
    return null;
  }
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    fields?: unknown;
  };
  if (typeof candidate.code !== 'string') {
    return null;
  }

  const fields: Record<string, string> = {};
  if (candidate.fields !== null && typeof candidate.fields === 'object') {
    for (const [key, value] of Object.entries(candidate.fields as Record<string, unknown>)) {
      if (typeof value === 'string') {
        fields[key] = value;
      }
    }
  }

  return {
    code: candidate.code as ErrorCode,
    message: typeof candidate.message === 'string' ? candidate.message : '',
    ...(Object.keys(fields).length === 0 ? {} : { fields }),
  };
}

/**
 * Creates the JSON API client. It never retries automatically — a lost write
 * response may already have committed, so the user must refresh and verify.
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const basePath = options.basePath ?? '/api/v1';

  return {
    timeoutMs,

    async request<T>(
      method: string,
      path: string,
      requestOptions: { body?: unknown; signal?: AbortSignal } = {},
    ): Promise<T> {
      if (requestOptions.signal?.aborted === true) {
        throw new ApiError({ kind: 'cancelled', code: 'CANCELLED' });
      }

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      const onAbort = (): void => controller.abort();
      requestOptions.signal?.addEventListener('abort', onAbort, { once: true });

      const headers: Record<string, string> = { Accept: 'application/json' };
      let body: string | undefined;
      if (requestOptions.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(requestOptions.body);
      }

      try {
        let response: HttpResponseLike;
        try {
          response = await fetchFn(`${basePath}${path}`, {
            method,
            headers,
            ...(body === undefined ? {} : { body }),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw timedOut
              ? new ApiError({ kind: 'timeout', code: 'TIMEOUT' })
              : new ApiError({ kind: 'cancelled', code: 'CANCELLED' });
          }
          throw new ApiError({
            kind: 'network',
            code: 'NETWORK_ERROR',
            message: error instanceof Error ? error.message : undefined,
          });
        }

        if (response.status === 204) {
          return undefined as T;
        }

        let payload: unknown = undefined;
        try {
          payload = await response.json();
        } catch {
          payload = undefined;
        }

        if (!response.ok) {
          const parsed = parseErrorBody(payload);
          if (parsed !== null) {
            throw new ApiError({
              kind: 'http',
              status: response.status,
              code: parsed.code,
              ...(parsed.fields === undefined ? {} : { fields: parsed.fields }),
            });
          }
          throw new ApiError({
            kind: 'http',
            status: response.status,
            code: fallbackCode(response.status),
          });
        }

        if (payload !== null && typeof payload === 'object' && 'data' in payload) {
          return (payload as { data: T }).data;
        }

        throw new ApiError({ kind: 'network', code: 'NETWORK_ERROR' });
      } finally {
        clearTimeout(timer);
        requestOptions.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

export interface TaskWriteBody extends TaskFieldInput {
  // Kept as a named alias so call sites read like the API contract.
}

export type { CreateBoardInput };