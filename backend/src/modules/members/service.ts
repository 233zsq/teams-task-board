import type Database from 'better-sqlite3';
import type { Member } from '@team-plan/shared';
import { listMemberRows, toMember } from '../../db/members';

export interface MemberService {
  listMembers(): Member[];
}

export interface MemberServiceDeps {
  db: Database.Database;
}

/** Read-only access to the four fixed, seeded members (no member management). */
export function createMemberService(deps: MemberServiceDeps): MemberService {
  return {
    listMembers(): Member[] {
      return listMemberRows(deps.db).map(toMember);
    },
  };
}