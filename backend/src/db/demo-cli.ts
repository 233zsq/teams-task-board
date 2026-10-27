import path from 'node:path';
import dotenv from 'dotenv';
import { openDatabase } from './connection';
import { resolveDemoDatabasePath, seedDemoData } from './demo';
import { initializeDatabase } from './initialize';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env') });

try {
  const demoPath = resolveDemoDatabasePath(PROJECT_ROOT);

  const init = initializeDatabase({
    databasePath: demoPath,
    migrationsDir: MIGRATIONS_DIR,
  });

  const db = openDatabase(demoPath);
  let result;
  try {
    result = seedDemoData(db.raw);
  } finally {
    db.close();
  }

  process.stdout.write(
    [
      `${init.created ? '已创建' : '已使用现有'}演示数据库：${demoPath}`,
      `迁移：${init.applied.length === 0 ? '无待执行' : init.applied.join(', ')}；当前版本 ${init.currentVersion ?? '无'}`,
      result.skipped
        ? `演示数据已存在，未重复写入：看板 ${result.boards} 个、任务 ${result.tasks} 个`
        : `已写入演示数据：看板 ${result.boards} 个、任务 ${result.tasks} 个（只影响演示数据库）`,
      '用 DATABASE_PATH 指向该文件即可启动演示：DATABASE_PATH=data/team-plan-demo.sqlite npm run dev:backend',
    ].join('\n') + '\n',
  );
} catch (error) {
  process.stderr.write(
    `演示数据准备失败：${error instanceof Error ? error.message : '未知错误'}\n`,
  );
  process.exit(1);
}