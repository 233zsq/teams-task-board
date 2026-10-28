import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import HealthGate from '../src/features/health/HealthGate.vue';
import { ApiError } from '../src/api/client';
import { createWorkspaceStore } from '../src/state/workspace';
import { createFakeApi, mountWithWorkspace } from './helpers/test-context';

describe('health gate', () => {
  it('blocks the app when the health check fails and recovers on retry', async () => {
    const api = createFakeApi({
      health: async () => {
        throw new ApiError({ kind: 'http', status: 503, code: 'SERVICE_UNAVAILABLE' });
      },
    });
    const store = createWorkspaceStore(api);

    const wrapper = mountWithWorkspace(HealthGate, store, {
      slots: { default: '<p data-testid="workspace">工作区内容</p>' },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('暂时无法连接服务');
    expect(wrapper.text()).toContain('服务暂不可用，请稍后重试');
    expect(wrapper.find('[data-testid="workspace"]').exists()).toBe(false);

    api.set('health', async () => ({
      status: 'ok' as const,
      features: { priority: false, filters: false, ordering: false, sharing: false },
    }));
    await wrapper.findAll('button')[0]!.trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="workspace"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('暂时无法连接服务');
  });

  it('does not render an empty workspace before health is known', async () => {
    const api = createFakeApi();
    const store = createWorkspaceStore(api);
    const wrapper = mountWithWorkspace(HealthGate, store, {
      slots: { default: '<p data-testid="workspace">工作区内容</p>' },
    });

    // The health request is still in flight in this tick.
    expect(wrapper.find('[data-testid="workspace"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('正在连接服务');

    await flushPromises();
    expect(wrapper.find('[data-testid="workspace"]').exists()).toBe(true);
  });

  it('supports priority and filters without asking for an unsupported-build refresh', async () => {
    const api = createFakeApi({
      health: async () => ({
        status: 'ok' as const,
        features: { priority: true, filters: true, ordering: false, sharing: false },
      }),
    });
    const store = createWorkspaceStore(api);

    const wrapper = mountWithWorkspace(HealthGate, store, {
      slots: { default: '<p>工作区内容</p>' },
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain('服务端启用了扩展功能');
    expect(wrapper.text()).toContain('工作区内容');
  });
});
