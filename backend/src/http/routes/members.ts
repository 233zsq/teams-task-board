import { Router } from 'express';
import type { MemberService } from '../../modules/members/service';
import { parseQuery } from '../validation';

export interface MembersRouterDeps {
  service: MemberService;
}

/** GET /members — read-only list of the four preset business members. */
export function membersRouter(deps: MembersRouterDeps): Router {
  const router = Router();

  router.get('/members', (req, res) => {
    parseQuery(req.query as Record<string, unknown>, []);
    res.status(200).json({ data: deps.service.listMembers() });
  });

  return router;
}