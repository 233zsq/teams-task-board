import { Router } from 'express';
import type { MemberService } from '../../modules/members/service';
import { assertUuidParam, parseQuery } from '../validation';
import type { ProjectService } from '../../modules/projects/service';
import { currentUser } from './accounts';

export interface MembersRouterDeps {
  service: MemberService;
  projects?: ProjectService;
}

/** GET /members — read-only list of the four preset business members. */
export function membersRouter(deps: MembersRouterDeps): Router {
  const router = Router();

  router.get('/members', (req, res) => {
    const query = parseQuery(req.query as Record<string, unknown>, deps.projects ? ['boardId'] : []);
    if (deps.projects) {
      if (query.boardId !== undefined) {
        const id = assertUuidParam(query.boardId);
        deps.projects.access(id, currentUser(res).id);
        res.json({ data: deps.projects.assignable(id) });
      } else res.json({ data: deps.projects.directory(currentUser(res).id) });
    } else res.status(200).json({ data: deps.service.listMembers() });
  });

  return router;
}
