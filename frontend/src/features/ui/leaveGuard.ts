/**
 * One registered leave guard for the currently open draft. Sidebar switching,
 * refresh and dialog close all ask it first; when it resolves false the action
 * is cancelled and the draft stays untouched.
 */
type LeaveGuard = () => Promise<boolean>;

let guard: LeaveGuard | null = null;

export function registerLeaveGuard(next: LeaveGuard | null): void {
  guard = next;
}

export async function confirmLeave(): Promise<boolean> {
  if (guard === null) {
    return true;
  }
  return guard();
}