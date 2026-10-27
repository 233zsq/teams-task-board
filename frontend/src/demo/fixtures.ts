import type { Board, Member, Task } from '@team-plan/shared';

export const BOARD_A = '22222222-2222-4222-8222-222222222222';
export const BOARD_B = '22222222-2222-4222-8222-222222222223';
export const boards: Board[] = [
  { id: BOARD_A, name: '课程项目', createdAt: '2026-10-20T02:00:00.000Z' },
  { id: BOARD_B, name: '答辩准备', createdAt: '2026-10-21T03:00:00.000Z' },
];
export const members: Member[] = ['A', 'B', 'C', 'D'].map((name, i) => ({
  id: `11111111-1111-4111-8111-11111111111${i + 1}`, displayName: `成员 ${name}`,
}));
export const tasks: Task[] = [
  { title: '完成看板导航与三列视图', description: '按冻结的 P0 契约实现看板切换、任务分列和详情展示。\n验收重点：加载、空态和请求失败必须可以区分。', status: 'doing', assigneeId: members[0]!.id, dueDate: '2026-10-28' },
  { title: '联调任务创建与读取接口', description: '与接口维护人一起核对真实数据库链路，记录看板和任务 ID。预览数据不能作为真实联调证据。', status: 'todo', assigneeId: members[3]!.id, dueDate: '2026-10-26' },
  { title: '检查慢请求与刷新恢复', description: '先延迟看板 A 的响应，再切换至看板 B。即使旧请求晚到，也不能覆盖新看板。', status: 'todo', assigneeId: members[0]!.id, dueDate: null },
  { title: '整理操作手册与演示步骤', description: '先展示成员 A 模块，再在真实接口齐备后复演团队核心流程。', status: 'todo', assigneeId: null, dueDate: '2026-10-30' },
  { title: '建立后端骨架与数据库迁移', description: '四名固定成员、三张业务表、迁移校验和与隔离数据库测试已经在仓库主分支提供。', status: 'done', assigneeId: members[1]!.id, dueDate: '2026-10-21' },
  { title: '核对规格与团队分工', description: '界面只展示当前交付范围。后续编辑、状态修改和删除由任务交互模块接入。', status: 'done', assigneeId: members[2]!.id, dueDate: null },
  { title: '验证长文本布局：在小屏幕上也应当完整阅读任务标题并保留清楚的负责人、状态和日期信息', description: '这是一段用于验证详情换行的较长文本。'.repeat(18) + '\n\n<script>alert("这里只显示文字")</script>', status: 'todo', assigneeId: members[2]!.id, dueDate: null },
].map((task, i) => ({
  ...task, id: `33333333-3333-4333-8333-33333333333${i + 1}`, boardId: BOARD_A,
  createdAt: `2026-10-22T02:0${i}:00.000Z`, updatedAt: `2026-10-23T03:0${i}:00.000Z`,
} as Task));
tasks.push({
  id: '33333333-3333-4333-8333-333333333338', boardId: BOARD_B,
  title: '准备成员 A 的演示材料', description: '展示看板导航、三列、详情以及刷新与请求竞态的测试记录。',
  status: 'todo', assigneeId: members[0]!.id, dueDate: '2026-10-31',
  createdAt: '2026-10-24T02:00:00.000Z', updatedAt: '2026-10-24T02:00:00.000Z',
});
