import { ApiError } from '../../api/client';

/**
 * Primary messages are mapped from the error `code`, never from the server
 * `message` (D-25). Timeout wording must steer the user to verify by refresh,
 * because a timed-out write may already have committed.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return '发生未知错误，请重试';
  }

  switch (error.code) {
    case 'UNAUTHENTICATED': return '请先登录，或重新登录已过期的会话';
    case 'INVALID_CREDENTIALS': return '用户名或密码不正确';
    case 'ACCESS_DENIED': return '仅项目负责人可以进行此操作';
    case 'ACCOUNT_EXISTS': return '该用户名已被使用，请换一个用户名';
    case 'RATE_LIMITED': return '操作过于频繁，请稍后再试';
    case 'CSRF_INVALID': return '会话校验失败，请刷新页面后重试';
    case 'TIMEOUT':
      return '请求超时，结果未知；请先刷新看板核对，再决定是否重试';
    case 'NETWORK_ERROR':
      return '无法连接服务，请确认后端已启动后重试';
    case 'SERVICE_UNAVAILABLE':
      return '服务暂不可用，请稍后重试';
    case 'INTERNAL_ERROR':
      return '服务器内部错误，请稍后重试';
    case 'BAD_REQUEST':
      return '请求格式不正确，请刷新页面后重试';
    case 'PAYLOAD_TOO_LARGE':
      return '提交内容超过 32 KiB，请精简后重试';
    case 'UNSUPPORTED_MEDIA_TYPE':
      return '请求格式不受支持，请刷新页面后重试';
    case 'FORBIDDEN':
      return '当前访问地址不在允许的主机列表，请检查后端启动配置';
    case 'NOT_FOUND':
      return '内容不存在或已被删除，请刷新';
    case 'EDITOR_KEY_REQUIRED':
      return '该操作需要维护密钥';
    case 'VALIDATION_ERROR':
      return '请检查输入内容';
    default:
      return '操作失败，请重试';
  }
}
