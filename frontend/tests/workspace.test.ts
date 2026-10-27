import { describe, expect, it } from 'vitest';
import { useWorkspace } from '../src/composables/useWorkspace';
import { createDemoApi } from '../src/demo/api';
import { BOARD_A, BOARD_B } from '../src/demo/fixtures';
import { RequestError } from '../src/api/service';

describe('Workspace snapshots', () => {
  it('rejects late responses even when cancellation is ignored', async () => {
    const api = createDemoApi(0);
    const original = api.listTasks;
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    api.listTasks = async id => { if (id === BOARD_A) { entered(); await hold; } return original(id); };
    const ws = useWorkspace(api);
    const a = ws.load(BOARD_A); await started;
    await ws.load(BOARD_B); release(); await a;
    expect(ws.board.value?.id).toBe(BOARD_B);
    expect(ws.tasks.value.every(t => t.boardId === BOARD_B)).toBe(true);
  });
  it('keeps loaded tasks and refresh time when refresh fails, and recovers', async () => {
    const api = createDemoApi(0), ws = useWorkspace(api);
    await ws.load(BOARD_A);
    const before = ws.tasks.value, time = ws.lastRefresh.value;
    api.setScenario('read-error'); await ws.load(BOARD_A, true);
    expect(ws.tasks.value).toEqual(before); expect(ws.lastRefresh.value).toBe(time);
    expect(ws.stale.value).toBe(true); expect(ws.error.value).toBeTruthy();
    api.setScenario('normal'); await ws.load(BOARD_A, true);
    expect(ws.error.value).toBe(''); expect(ws.stale.value).toBe(false);
  });
  it('separates failed members from unassigned and keeps task data available', async () => {
    const api = createDemoApi(0), ws = useWorkspace(api);
    api.listMembers = async () => { throw new RequestError('http', 'SERVICE_UNAVAILABLE', 503); };
    await ws.load(BOARD_A);
    expect(ws.membersError.value).toBeTruthy(); expect(ws.tasks.value.length).toBeGreaterThan(0);
    expect(ws.lastRefresh.value).toBeNull();
  });
});
