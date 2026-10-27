import { describe, expect, it } from 'vitest';
import {
  businessToday,
  countCodePoints,
  daysInMonth,
  formatBusinessDateTime,
  isLeapYear,
  isOverdue,
  isValidDateString,
  isUuid,
  normalizeBoardName,
  normalizeTaskDescription,
  normalizeTaskTitle,
  parseTaskCreateInput,
  parseTaskUpdateInput,
} from '../src';

describe('text rules', () => {
  it('trims names and titles but keeps descriptions verbatim', () => {
    const name = normalizeBoardName('  课程作业  ');
    expect(name).toEqual({ ok: true, value: '课程作业' });

    const title = normalizeTaskTitle('  完成联调  ');
    expect(title).toEqual({ ok: true, value: '完成联调' });

    const description = normalizeTaskDescription('  第一行\n第二行  ');
    expect(description).toEqual({ ok: true, value: '  第一行\n第二行  ' });
  });

  it('counts Unicode code points and accepts the documented boundaries', () => {
    expect(countCodePoints('😀')).toBe(1);
    expect(countCodePoints('👨‍👩‍👧‍👦')).toBe(7);

    expect(normalizeBoardName('名'.repeat(50)).ok).toBe(true);
    expect(normalizeBoardName('名'.repeat(51)).ok).toBe(false);
    expect(normalizeTaskTitle('标'.repeat(100)).ok).toBe(true);
    expect(normalizeTaskTitle('标'.repeat(101)).ok).toBe(false);
    expect(normalizeTaskDescription('字'.repeat(2000)).ok).toBe(true);
    expect(normalizeTaskDescription('字'.repeat(2001)).ok).toBe(false);
  });

  it('rejects blank names and titles', () => {
    expect(normalizeBoardName('   ').ok).toBe(false);
    expect(normalizeTaskTitle('').ok).toBe(false);
    expect(normalizeBoardName(42).ok).toBe(false);
    expect(normalizeTaskTitle(null).ok).toBe(false);
  });

  it('rejects zero-width, bidi and control characters in names/titles', () => {
    for (const bad of [
      'a\u0000b',
      'a\nb',
      'a\tb',
      'a\u00adb',
      'a\u200bb',
      'a\u200eb',
      'a\u202eb',
      'a\u2066b',
      'a\ufeffb',
    ]) {
      expect(normalizeBoardName(bad).ok).toBe(false);
      expect(normalizeTaskTitle(bad).ok).toBe(false);
    }

    // ZWJ/ZWNJ stay allowed for emoji sequences and text shaping.
    expect(normalizeTaskTitle('👨\u200d👩\u200d👧').ok).toBe(true);
    expect(normalizeTaskTitle('क्\u200dष').ok).toBe(true);
  });

  it('keeps newlines and tabs in descriptions but rejects bidi overrides', () => {
    expect(normalizeTaskDescription('第一行\n第二行\r\n\t缩进').ok).toBe(true);
    expect(normalizeTaskDescription('a\u0000b').ok).toBe(false);
    expect(normalizeTaskDescription('a\u202eb').ok).toBe(false);
    expect(normalizeTaskDescription(null).ok).toBe(false);
  });
});

describe('date rules', () => {
  it('implements leap years without using Date parsing', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('validates calendar dates including the 0001–9999 year range', () => {
    for (const good of [
      '2026-10-23',
      '2028-02-29',
      '2000-02-29',
      '0001-01-01',
      '9999-12-31',
    ]) {
      expect(isValidDateString(good)).toBe(true);
    }

    for (const bad of [
      '2026-02-29',
      '2026-02-30',
      '2026-2-3',
      '2026-00-10',
      '2026-13-01',
      '2026-04-31',
      '0000-01-01',
      '0100-02-29',
      '1900-02-29',
      '2026-10-23T00:00:00.000Z',
      ' 2026-10-23',
    ]) {
      expect(isValidDateString(bad)).toBe(false);
    }
  });

  it('computes the business date in Asia/Shanghai regardless of device zone', () => {
    expect(businessToday(new Date('2026-10-20T15:59:59.999Z'))).toBe('2026-10-20');
    expect(businessToday(new Date('2026-10-20T16:00:00.000Z'))).toBe('2026-10-21');
  });

  it('marks only past, not-done dates as overdue', () => {
    const today = '2026-10-20';
    expect(isOverdue('2026-10-19', 'todo', today)).toBe(true);
    expect(isOverdue('2026-10-19', 'doing', today)).toBe(true);
    expect(isOverdue('2026-10-19', 'done', today)).toBe(false);
    expect(isOverdue('2026-10-20', 'todo', today)).toBe(false);
    expect(isOverdue('2026-10-21', 'todo', today)).toBe(false);
    expect(isOverdue(null, 'todo', today)).toBe(false);
  });

  it('formats timestamps in the business time zone to the minute', () => {
    expect(formatBusinessDateTime('2026-10-20T02:00:00.000Z')).toBe('2026-10-20 10:00');
    expect(formatBusinessDateTime('2026-10-20T16:05:00.000Z')).toBe('2026-10-21 00:05');
  });

  it('accepts only UUID-shaped strings', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('11111111-1111-4111-8111-11111111111')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

describe('task input parsing', () => {
  it('applies creation defaults for omitted optional fields', () => {
    expect(parseTaskCreateInput({ title: '  只写标题  ' })).toEqual({
      ok: true,
      value: {
        title: '只写标题',
        description: '',
        dueDate: null,
        assigneeId: null,
        status: 'todo',
      },
    });
  });

  it('never treats null as an empty description', () => {
    const result = parseTaskCreateInput({ title: '标题', description: null });
    expect(result.ok).toBe(false);
  });

  it('requires all five fields on update and reports each missing field', () => {
    const result = parseTaskUpdateInput({});
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(Object.keys(result.fields).sort()).toEqual([
      'assigneeId',
      'description',
      'dueDate',
      'status',
      'title',
    ]);
  });

  it('accepts explicit nulls and empty strings on update', () => {
    expect(
      parseTaskUpdateInput({
        title: '标题',
        description: '',
        dueDate: null,
        assigneeId: null,
        status: 'doing',
      }),
    ).toEqual({
      ok: true,
      value: {
        title: '标题',
        description: '',
        dueDate: null,
        assigneeId: null,
        status: 'doing',
      },
    });
  });

  it('rejects unknown enum/date/assignee values with field errors', () => {
    const result = parseTaskCreateInput({
      title: '标题',
      dueDate: '2026-02-30',
      assigneeId: 'nope',
      status: 'Doing',
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.fields).toEqual({
      dueDate: '截止日期必须是 YYYY-MM-DD 格式的有效日期',
      assigneeId: '负责人格式不正确',
      status: '状态只能是 todo、doing 或 done',
    });
  });
});