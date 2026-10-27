import type { Member, Task } from '@team-plan/shared';
import type { Resource } from '../../state/workspace';

export const UNASSIGNED_LABEL = '未分配';
/** Distinguishable from a real "unassigned" value when members failed to load. */
export const MEMBER_UNAVAILABLE_LABEL = '负责人信息不可用';

export function assigneeName(task: Task, members: Resource<Member[]>): string {
  if (task.assigneeId === null) {
    return UNASSIGNED_LABEL;
  }
  if (members.status !== 'ready') {
    return MEMBER_UNAVAILABLE_LABEL;
  }
  const member = members.data.find((item) => item.id === task.assigneeId);
  return member === undefined ? MEMBER_UNAVAILABLE_LABEL : member.displayName;
}