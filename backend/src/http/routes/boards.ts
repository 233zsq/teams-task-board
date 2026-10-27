import { Router } from 'express';
import { parseBoardNameInput } from '@team-plan/shared';
import type { BoardService } from '../../modules/boards/service';
import { AppError } from '../errors';
import { writeRoute } from '../middleware/json-body';
import { assertAllowedKeys, assertUuidParam, parseQuery, pathParam } from '../validation';

export interface BoardsRouterDeps {
  service: BoardService;
}

/** GET /boards, POST /boards, GET /boards/:boardId (spec §9.2). */
export function boardsRouter(deps: BoardsRouterDeps): Router {
  const router = Router();

  router.get('/boards', (req, res) => {
    parseQuery(req.query as Record<string, unknown>, []);
    res.status(200).json({ data: deps.service.listBoards() });
  });

  router.post(
    '/boards',
    ...writeRoute((req, res) => {
      parseQuery(req.query as Record<string, unknown>, []);
      const body = req.body as Record<string, unknown>;
      assertAllowedKeys(body, ['name']);

      const parsed = parseBoardNameInput(body);
      if (!parsed.ok) {
        throw new AppError(422, 'VALIDATION_ERROR', { fields: parsed.fields });
      }

      res.status(201).json({ data: deps.service.createBoard(parsed.value) });
    }),
  );

  router.get('/boards/:boardId', (req, res) => {
    parseQuery(req.query as Record<string, unknown>, []);
    const boardId = assertUuidParam(pathParam(req.params.boardId));
    res.status(200).json({ data: deps.service.getBoard(boardId) });
  });

  return router;
}