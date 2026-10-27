import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { insertBoardRow } from './boards';
import { insertTaskRow, type TaskRow } from './tasks';

export interface DemoSeedOptions {
  boards?: number;
  tasksPerBoard?: number;
  /** Fixed base instant so repeated runs produce the same ordering. */
  baseTime?: string;
}

export interface DemoSeedResult {
  boards: number;
  tasks: number;
  skipped: boolean;
}

const BOARD_NAMES = [
  '课程作业',
  '答辩准备',
  '产品原型',
  '需求评审',
  '测试计划',
  '部署演练',
  '接口联调',
  '文档整理',
  '演示彩排',
  '复盘总结',
];

const MEMBER_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111112',
  '11111111-1111-4111-8111-111111111113',
  '11111111-1111-4111-8111-111111111114',
];

const TASK_TOPICS: Array<[string, string]> = [
  ['确认课程评分与交付要求', '核对演示环境、浏览器版本和最终提交材料清单。'],
  ['完成接口联调', '覆盖创建、编辑和状态修改；刷新与重启后数据不丢失。'],
  ['实现任务看板三列视图', '待办/进行中/已完成三列，按创建时间稳定排序。'],
  ['补充表单校验与错误提示', '标题 1～100 字符，描述最多 2000 字符，日期须为真实公历日期。'],
  ['编写双浏览器验收脚本', '记录两个浏览器先后保存同一任务的最终值，以及删除后编辑返回 404 的提示。'],
  ['准备课程演示 PPT', '10 分钟演示脚本：建板 → 建任务 → 指定负责人和日期 → 修改状态 → 刷新。'],
  ['梳理数据库迁移与备份', '停服复制数据库，恢复前核对迁移编号与校验和。'],
  ['整理 API 错误码对照表', '400/404/413/415/422/500/503 与统一错误对象。'],
  ['检查窄屏滚动提示', '360 CSS 像素宽度下允许横向滚动并显示列数提示。'],
  ['复核分享功能的访问控制', '私有接口统一维护密钥，公开路由只读。'],
];

function pad(value: number): string {
  return String(value).padStart(12, '0');
}

function demoBoardId(index: number): string {
  return `44444444-4444-4444-8444-${pad(index + 1)}`;
}

function demoTaskId(index: number): string {
  return `55555555-5555-4555-8555-${pad(index + 1)}`;
}

function dateOffset(baseIso: string, days: number): string {
  const base = new Date(baseIso);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * Deterministic demo data for the dedicated demo database: 10 boards and 200
 * tasks with mixed statuses, assignees and dates. Fixed IDs keep re-runs
 * idempotent, and an existing non-empty database is left untouched.
 */
export function seedDemoData(
  db: Database.Database,
  options: DemoSeedOptions = {},
): DemoSeedResult {
  const boardCount = options.boards ?? 10;
  const tasksPerBoard = options.tasksPerBoard ?? 20;
  const baseTime = options.baseTime ?? '2026-10-01T00:00:00.000Z';

  const existing = db.prepare('SELECT COUNT(*) AS count FROM boards').get() as {
    count: number;
  };
  if (existing.count > 0) {
    const taskCount = db.prepare('SELECT COUNT(*) AS count FROM tasks').get() as {
      count: number;
    };
    return { boards: existing.count, tasks: taskCount.count, skipped: true };
  }

  const statuses = ['todo', 'doing', 'done'] as const;
  let taskIndex = 0;

  db.transaction(() => {
    for (let boardIndex = 0; boardIndex < boardCount; boardIndex += 1) {
      const boardId = demoBoardId(boardIndex);
      const boardCreatedAt = new Date(
        new Date(baseTime).getTime() + boardIndex * 60_000,
      ).toISOString();

      insertBoardRow(db, {
        id: boardId,
        name: BOARD_NAMES[boardIndex % BOARD_NAMES.length]!,
        createdAt: boardCreatedAt,
      });

      for (let itemIndex = 0; itemIndex < tasksPerBoard; itemIndex += 1) {
        const topic = TASK_TOPICS[(boardIndex + itemIndex) % TASK_TOPICS.length]!;
        const createdAt = new Date(
          new Date(baseTime).getTime() + boardIndex * 60_000 + (itemIndex + 1) * 1_000,
        ).toISOString();

        const row: TaskRow = {
          id: demoTaskId(taskIndex),
          board_id: boardId,
          title:
            itemIndex >= TASK_TOPICS.length
              ? `${topic[0]}（${itemIndex + 1}）`
              : topic[0],
          description: topic[1],
          due_date:
            itemIndex % 4 === 0 ? null : dateOffset(baseTime, ((itemIndex % 7) - 3) * 2),
          assignee_id: itemIndex % 5 === 4 ? null : MEMBER_IDS[(boardIndex + itemIndex) % 4]!,
          status: statuses[itemIndex % statuses.length]!,
          created_at: createdAt,
          updated_at: createdAt,
        };

        taskIndex += 1;
        insertTaskRow(db, row);
      }
    }
  })();

  return { boards: boardCount, tasks: boardCount * tasksPerBoard, skipped: false };
}

/** Remove the demo database file and its journal/wal companions. */
export function deleteDemoDatabase(databasePath: string): boolean {
  if (!fs.existsSync(databasePath)) {
    return false;
  }
  fs.rmSync(databasePath, { force: true });
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const companion = `${databasePath}${suffix}`;
    if (fs.existsSync(companion)) {
      fs.rmSync(companion, { force: true });
    }
  }
  return true;
}

/** Default location for the demo database (never the main database path). */
export function resolveDemoDatabasePath(projectRoot: string): string {
  const configured = process.env.DEMO_DATABASE_PATH?.trim();
  if (configured !== undefined && configured !== '') {
    return path.resolve(projectRoot, configured);
  }
  return path.resolve(projectRoot, 'data/team-plan-demo.sqlite');
}