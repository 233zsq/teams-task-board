import type Database from 'better-sqlite3';
import type { Board } from '@team-plan/shared';
import { getBoardRow, insertBoardRow, listBoardRows, toBoard } from '../../db/boards';
import { withWriteTransaction } from '../../db/transaction';
import { NotFoundError } from '../errors';

export interface BoardService {
  listBoards(): Board[];
  getBoard(boardId: string): Board;
  createBoard(input: { name: string }): Board;
}

export interface BoardServiceDeps {
  db: Database.Database;
  now: () => Date;
  generateId: () => string;
}

export function createBoardService(deps: BoardServiceDeps): BoardService {
  return {
    listBoards(): Board[] {
      return listBoardRows(deps.db).map(toBoard);
    },

    getBoard(boardId: string): Board {
      const row = getBoardRow(deps.db, boardId);
      if (row === undefined) {
        throw new NotFoundError();
      }
      return toBoard(row);
    },

    createBoard(input: { name: string }): Board {
      const board: Board = {
        id: deps.generateId(),
        name: input.name,
        createdAt: deps.now().toISOString(),
      };

      withWriteTransaction(deps.db, () => {
        insertBoardRow(deps.db, board);
      });

      return board;
    },
  };
}