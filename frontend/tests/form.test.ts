import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import TaskForm from '../src/components/TaskForm.vue';
import { isCalendarDate, validateTaskInput } from '@team-plan/shared';
const props = { members: [], membersError: '', saving: false, fields: {}, error: '', initialStatus: 'todo' as const, uncertain: false };
describe('Task creation draft', () => {
  it('validates before emitting and normalizes optional blank fields', async () => {
    const wrapper = mount(TaskForm, { props });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')).toBeUndefined();
    expect(wrapper.text()).toContain('请输入任务标题');
    await wrapper.get('#task-title').setValue('课程任务');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')?.[0]).toEqual([{ title: '课程任务', description: '', dueDate: null, assigneeId: null, status: 'todo' }]);
  });
  it('retains inputs after server error and blocks submission during saving, unavailable members or uncertain writes', async () => {
    const wrapper = mount(TaskForm, { props });
    await wrapper.get('#task-title').setValue('保留草稿');
    await wrapper.setProps({ fields: { title: '服务器校验失败' }, error: '服务暂不可用' });
    await flushPromises();
    expect((wrapper.get('#task-title').element as HTMLInputElement).value).toBe('保留草稿');
    for (const state of [{ saving: true }, { saving: false, membersError: '无法读取' }, { membersError: '', uncertain: true }]) {
      await wrapper.setProps(state); await wrapper.get('form').trigger('submit');
    }
    expect(wrapper.emitted('save')).toBeUndefined();
  });
  it('validates calendar dates and Unicode boundaries independently of machine timezone', () => {
    for (const value of ['0001-01-01', '2000-02-29', '9999-12-31']) expect(isCalendarDate(value)).toBe(true);
    for (const value of ['0000-01-01', '0100-02-29', '1900-02-29', '2026-02-30', '2026-1-1']) expect(isCalendarDate(value)).toBe(false);
    expect(validateTaskInput({ title: '😀'.repeat(100), description: 'a\n\t' })).toEqual({});
    expect(validateTaskInput({ title: '😀'.repeat(101) })).toHaveProperty('title');
    expect(validateTaskInput({ title: '\ufeff标题' })).toHaveProperty('title');
  });
});
