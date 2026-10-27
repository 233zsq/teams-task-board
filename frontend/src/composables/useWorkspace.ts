import { ref } from 'vue';
import { compareCreated, type Board, type Member, type Task } from '@team-plan/shared';
import { asRequestError, type BoardApi } from '../api/service';

export function useWorkspace(api: BoardApi) {
  const boards = ref<Board[]>([]), members = ref<Member[]>([]), tasks = ref<Task[]>([]);
  const board = ref<Board | null>(null);
  const loading = ref(false), refreshing = ref(false), stale = ref(false);
  const error = ref(''), membersError = ref(''), boardsError = ref('');
  const lastRefresh = ref<string | null>(null);
  let generation = 0;
  let controller: AbortController | undefined;
  async function load(boardId?: string, refresh = false): Promise<string | undefined> {
    const current = ++generation;
    controller?.abort(); controller = new AbortController();
    const options = { signal: controller.signal };
    if (!refresh) { tasks.value = []; board.value = null; lastRefresh.value = null; loading.value = true; }
    else refreshing.value = true;
    error.value = ''; boardsError.value = ''; stale.value = false;
    try {
      const [boardResult, memberResult] = await Promise.allSettled([api.listBoards(options), api.listMembers(options)]);
      if (current !== generation) return;
      if (memberResult.status === 'fulfilled') { members.value = memberResult.value; membersError.value = ''; }
      else membersError.value = asRequestError(memberResult.reason).message;
      if (boardResult.status === 'fulfilled') boards.value = boardResult.value.sort(compareCreated);
      else boardsError.value = asRequestError(boardResult.reason).message;
      const selected = boardId ?? (boardResult.status === 'fulfilled' ? boards.value[0]?.id : undefined);
      if (!selected) {
        if (boardsError.value) error.value = boardsError.value;
        return;
      }
      const nextBoard = await api.getBoard(selected, options);
      const nextTasks = await api.listTasks(selected, options);
      if (current !== generation) return;
      board.value = nextBoard; tasks.value = nextTasks.sort(compareCreated);
      stale.value = !!membersError.value || !!boardsError.value;
      if (!stale.value) lastRefresh.value = new Date().toISOString();
      return selected;
    } catch (e) {
      if (current !== generation) return;
      const failure = asRequestError(e);
      if (failure.kind !== 'aborted') {
        error.value = failure.status === 404 ? '看板不存在，请返回看板列表。' : failure.message;
        if (refresh) stale.value = true;
      }
    } finally {
      if (current === generation) { loading.value = false; refreshing.value = false; }
    }
  }
  function dispose() { ++generation; controller?.abort(); }
  function addTask(task: Task) { if (board.value?.id === task.boardId) tasks.value = [...tasks.value, task].sort(compareCreated); }
  return { boards, members, tasks, board, loading, refreshing, stale, error, membersError, boardsError, lastRefresh, load, dispose, addTask };
}
