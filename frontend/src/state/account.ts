import { reactive } from 'vue';
import type { AccountSession, AccountUser } from '@team-plan/shared';
import { createApiClient, setCsrfToken } from '../api/client';
import { workspace } from './workspace';

export const accountApi = createApiClient();
export const account = reactive<{ user: AccountUser | null; ready: boolean }>({ user: null, ready: false });

export function acceptSession(session: AccountSession): void {
  if (account.user?.id !== session.user?.id) workspace.reset();
  account.user = session.user;
  account.ready = true;
  setCsrfToken(session.csrfToken);
}

export async function restoreSession(): Promise<void> {
  acceptSession(await accountApi.request<AccountSession>('GET', '/auth/me'));
}

export function forgetSession(): void {
  acceptSession({ user: null, csrfToken: null });
}
