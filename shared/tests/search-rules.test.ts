import { describe, expect, it } from 'vitest';
import { parseTaskCreateInput, parseTaskUpdateInput, parseTaskFilters, parseTaskPriority, taskToFieldInput, type Task } from '../src';

describe('priority and query rules', () => {
  const input = { title: '有效标题', description: '', assigneeId: null, dueDate: null, status: 'todo' };
  it('defaults priority only on create and requires it on full PUT', () => {
    expect(parseTaskCreateInput({ title: '新建' }, true)).toMatchObject({ ok: true, value: { priority: 'medium' } });
    expect(parseTaskUpdateInput(input, true)).toMatchObject({ ok: false, fields: { priority: expect.any(String) } });
    expect(parseTaskUpdateInput({ ...input, priority: 'high' }, true)).toMatchObject({ ok: true, value: { priority: 'high' } });
    expect(parseTaskUpdateInput({}, true)).toMatchObject({ ok: false, fields: { title: expect.any(String), priority: expect.any(String) } });
  });
  it('validates exactly three priorities and preserves priority in status writes', () => {
    for (const value of ['low', 'medium', 'high']) expect(parseTaskPriority(value).ok).toBe(true);
    for (const value of [null, 1, '', 'urgent', 'HIGH']) expect(parseTaskPriority(value).ok).toBe(false);
    expect(taskToFieldInput({ ...input, priority: 'high' } as Task, { status: 'done' }).priority).toBe('high');
  });
  it('normalizes empty controls and accepts literal keywords and Unicode length boundaries', () => {
    expect(parseTaskFilters({ q: '   ', assigneeId: '', dueFrom: '', dueTo: '', priority: '' })).toEqual({ ok: true, value: {} });
    expect(parseTaskFilters({ q: '  课程 100%_  ' })).toEqual({ ok: true, value: { q: '课程 100%_' } });
    expect(parseTaskFilters({ q: '😀'.repeat(100) }).ok).toBe(true);
    expect(parseTaskFilters({ q: '😀'.repeat(101) }).ok).toBe(false);
    for (const q of ['坏\n词', '坏\u200b词', '坏\u202e词']) expect(parseTaskFilters({ q }).ok).toBe(false);
  });
  it('requires valid bounded date/member/priority values and non-reversed ranges', () => {
    for (const raw of [{ dueFrom: '2026-02-29' }, { dueFrom: null }, { dueFrom: '2026-10-29', dueTo: '2026-10-28' }, { assigneeId: null }, { priority: 'urgent' }]) expect(parseTaskFilters(raw).ok).toBe(false);
    expect(parseTaskFilters({ dueFrom: '2028-02-29', dueTo: '2028-02-29', assigneeId: 'unassigned', priority: 'high' }).ok).toBe(true);
  });
});
