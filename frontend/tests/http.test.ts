import { describe, expect, it, vi } from 'vitest';
import { createHttpApi } from '../src/api/http';

describe('HTTP transport', () => {
  it('uses same-origin routes and sends one create request with frozen defaults omitted', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'task' } }), { status: 201 }));
    expect(await createHttpApi(fetcher).createTask('board', { title: '任务' })).toEqual({ id: 'task' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/boards/board/tasks');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"title":"任务"}', cache: 'no-store' });
  });
  it('maps fixed field errors without relying on raw server messages', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'private', fields: { title: '标题不能为空' } } }), { status: 422 }));
    await expect(createHttpApi(fetcher).createTask('b', { title: '' })).rejects.toMatchObject({ status: 422, fields: { title: '标题不能为空' }, message: '请检查输入内容' });
  });
  it('times out without retry even when the transport ignores abort', async () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    await expect(createHttpApi(fetcher, 5).createBoard({ name: '未知结果' })).rejects.toMatchObject({ kind: 'timeout' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('supports cancellation and rejects invalid success envelopes', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    await expect(createHttpApi(fetcher).listBoards({ signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(createHttpApi(fetcher).listBoards()).rejects.toMatchObject({ kind: 'contract' });
  });
});
