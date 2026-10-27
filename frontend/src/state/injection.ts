import { inject, provide, type InjectionKey } from 'vue';
import { workspace, type WorkspaceStore } from './workspace';

/** Components read the workspace through this key so tests can inject a store. */
export const WORKSPACE_KEY: InjectionKey<WorkspaceStore> = Symbol('team-plan-workspace');

export function provideWorkspace(store: WorkspaceStore): void {
  provide(WORKSPACE_KEY, store);
}

export function useWorkspaceStore(): WorkspaceStore {
  return inject(WORKSPACE_KEY, workspace);
}