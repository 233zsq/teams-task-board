import { Router } from 'express';
import { parseBoardNameInput } from '@team-plan/shared';
import type { BoardService } from '../../modules/boards/service';
import { AppError } from '../errors';
import { writeRoute } from '../middleware/json-body';
import { assertAllowedKeys, assertUuidParam, parseQuery, pathParam } from '../validation';
import type Database from 'better-sqlite3';
import type { ProjectService } from '../../modules/projects/service';
import { currentUser } from './accounts';

export interface BoardsRouterDeps {
  service: BoardService;
  projects?: ProjectService;
  db: Database.Database;
}

/** GET /boards, POST /boards, GET /boards/:boardId (spec §9.2). */
export function boardsRouter(deps: BoardsRouterDeps): Router {
  const router = Router();

  router.get('/boards', (req, res) => {
    parseQuery(req.query as Record<string, unknown>, []);
    const list = deps.service.listBoards();
    res.status(200).json({ data: deps.projects
      ? list.filter((board) => deps.projects!.visible(board.id, currentUser(res).id)).map((board) => deps.projects!.board(board, currentUser(res).id))
      : list });
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

      const board = deps.db.transaction(() => {
        const created = deps.service.createBoard(parsed.value);
        if (deps.projects) deps.projects.attachBoard(created, currentUser(res).id);
        return created;
      })();
      res.status(201).json({ data: deps.projects ? deps.projects.board(board, currentUser(res).id) : board });
    }),
  );

  router.get('/boards/:boardId', (req, res) => {
    parseQuery(req.query as Record<string, unknown>, []);
    const boardId = assertUuidParam(pathParam(req.params.boardId));
    const board = deps.service.getBoard(boardId);
    res.status(200).json({ data: deps.projects ? deps.projects.board(board, currentUser(res).id) : board });
  });

  return router;
}
