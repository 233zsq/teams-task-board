import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../src/App.vue';
import { API_KEY, RequestError } from '../src/api/service';
import { createDemoApi } from '../src/demo/api';

describe('Health gate', () => {
  it('blocks the workspace on 503 and permits retry', async () => {
    const api = createDemoApi(0), original = api.health;
    api.health = async () => { throw new RequestError('http', 'SERVICE_UNAVAILABLE', 503); };
    const wrapper = mount(App, { global: { provide: { [API_KEY as symbol]: api }, stubs: { RouterView: { template: '<div>工作区内容</div>' } } } });
    await flushPromises();
    expect(wrapper.text()).toContain('暂时无法进入工作区'); expect(wrapper.text()).not.toContain('工作区内容');
    api.health = original;
    await wrapper.get('button').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 5)); await flushPromises();
    expect(wrapper.text()).toContain('工作区内容'); wrapper.unmount();
  });
});
