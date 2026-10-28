import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import ModalDialog from '../src/features/ui/ModalDialog.vue';

describe('modal keyboard after async form controls lose focus', () => {
  it('closes on Escape even after a disabled input moves focus to body', async () => {
    const onClose = vi.fn();
    const wrapper = mount(ModalDialog, { props: { title: '项目成员', onClose }, slots: { default: '<input aria-label="成员用户名">' }, attachTo: document.body });
    await nextTick();
    const input = wrapper.find('input').element as HTMLInputElement;
    input.focus(); input.disabled = true; input.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('recovers Tab focus into the dialog if asynchronous work moved focus outside', async () => {
    const wrapper = mount(ModalDialog, { props: { title: '项目成员' }, slots: { default: '<input aria-label="成员用户名">' }, attachTo: document.body });
    await nextTick();
    (document.activeElement as HTMLElement | null)?.blur();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(wrapper.find('[role="dialog"]').element.contains(document.activeElement)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    wrapper.unmount();
  });
});
