/**
 * Error codes and baseline messages (spec §9.1, architecture §14.4).
 * The frontend maps the primary message by `code`; `message` is only a
 * fallback/log hint and must never echo user input.
 */

export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCESS_DENIED: 'ACCESS_DENIED',
  ACCOUNT_EXISTS: 'ACCOUNT_EXISTS',
  RATE_LIMITED: 'RATE_LIMITED',
  CSRF_INVALID: 'CSRF_INVALID',
  BAD_REQUEST: 'BAD_REQUEST',
  EDITOR_KEY_REQUIRED: 'EDITOR_KEY_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: '请先登录，或重新登录已过期的会话',
  INVALID_CREDENTIALS: '用户名或密码不正确',
  ACCESS_DENIED: '仅项目负责人可以进行此操作',
  ACCOUNT_EXISTS: '该用户名已被使用',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  CSRF_INVALID: '会话校验失败，请刷新页面后重试',
  BAD_REQUEST: '请求格式不正确',
  EDITOR_KEY_REQUIRED: '需要维护密钥',
  FORBIDDEN: '请求来源不在允许的主机列表',
  NOT_FOUND: '资源不存在',
  METHOD_NOT_ALLOWED: '不支持该操作',
  PAYLOAD_TOO_LARGE: '请求内容超过 32 KiB',
  UNSUPPORTED_MEDIA_TYPE: '请求格式不受支持',
  VALIDATION_ERROR: '请检查输入内容',
  INTERNAL_ERROR: '服务器内部错误',
  SERVICE_UNAVAILABLE: '服务暂不可用，请稍后重试',
};

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}
