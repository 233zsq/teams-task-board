import type { Board, CreateBoardInput, CreateTaskInput, Health, Member, Task } from '@team-plan/shared';
import type { InjectionKey } from 'vue';

export interface ReadOptions { signal?: AbortSignal }
/** D owns this boundary. Views are independent of the transport. */
export interface BoardApi {
  health(options?: ReadOptions): Promise<Health>;
  listBoards(options?: ReadOptions): Promise<Board[]>;
  createBoard(input: CreateBoardInput): Promise<Board>;
  getBoard(boardId: string, options?: ReadOptions): Promise<Board>;
  listMembers(options?: ReadOptions): Promise<Member[]>;
  listTasks(boardId: string, options?: ReadOptions): Promise<Task[]>;
  getTask(boardId: string, taskId: string, options?: ReadOptions): Promise<Task>;
  createTask(boardId: string, input: CreateTaskInput): Promise<Task>;
}
export const API_KEY: InjectionKey<BoardApi> = Symbol('board-api');

export type FailureKind = 'http' | 'network' | 'timeout' | 'aborted' | 'contract';
const MESSAGES: Record<string, string> = {
  BAD_REQUEST: '请求格式不符合约定，请刷新后重试',
  FORBIDDEN: '访问地址未获服务允许，请检查服务配置',
  NOT_FOUND: '请求的内容不存在',
  VALIDATION_ERROR: '请检查输入内容',
  INTERNAL_ERROR: '服务暂时发生错误，请稍后重试',
  SERVICE_UNAVAILABLE: '服务暂时不可用，请检查后端后重试',
  PAYLOAD_TOO_LARGE: '提交内容过大，请缩短后重试',
  UNSUPPORTED_MEDIA_TYPE: '提交格式不受支持，请刷新页面',
  EDITOR_KEY_REQUIRED: '此服务需要维护密钥，当前界面尚未支持此功能',
};
export class RequestError extends Error {
  constructor(
    public kind: FailureKind,
    public code: string,
    public status?: number,
    public fields?: Record<string, string>,
  ) {
    super(kind === 'http' ? (MESSAGES[code] ?? '请求失败，请稍后重试')
      : kind === 'timeout' ? '请求超过 10 秒，请刷新查证服务端结果'
      : kind === 'network' ? '网络连接失败，请检查连接后重试'
      : kind === 'contract' ? '服务响应不符合约定，请联系接口维护人'
      : '请求已取消');
    this.name = 'RequestError';
  }
}
export function asRequestError(error: unknown): RequestError {
  return error instanceof RequestError ? error : new RequestError('network', 'NETWORK_ERROR');
}
