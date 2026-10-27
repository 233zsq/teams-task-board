import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import dotenv from 'dotenv';
import { deleteDemoDatabase, resolveDemoDatabasePath } from './demo';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env') });

async function main(): Promise<void> {
  const demoPath = resolveDemoDatabasePath(PROJECT_ROOT);
  const fileName = path.basename(demoPath).toLowerCase();
  const force = process.argv.includes('--force');
  const assumeYes = process.argv.includes('--yes');

  // Safety rail: the reset only ever removes clearly-marked demo databases.
  if (!fileName.includes('demo') && !force) {
    process.stderr.write(
      [
        `拒绝删除：${demoPath}`,
        '该路径的文件名不含 “demo”，不像演示数据库。若确认这是可丢弃的演示库，请加 --force 重新执行。',
      ].join('\n') + '\n',
    );
    process.exit(1);
  }

  if (!fs.existsSync(demoPath)) {
    process.stdout.write(`无需重置：演示数据库不存在（${demoPath}）\n`);
    return;
  }

  let confirmed = assumeYes;
  if (!confirmed) {
    if (!process.stdin.isTTY) {
      process.stderr.write('非交互环境请加 --yes 明确确认后重试。\n');
      process.exit(1);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `将删除演示数据库 ${demoPath}（只清理演示数据，不影响 DATABASE_PATH 的主库）。输入 yes 确认：`,
    );
    rl.close();
    confirmed = answer.trim().toLowerCase() === 'yes';
  }

  if (!confirmed) {
    process.stdout.write('已取消，未删除任何文件。\n');
    return;
  }

  deleteDemoDatabase(demoPath);
  process.stdout.write(`已删除演示数据库：${demoPath}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `重置演示数据失败：${error instanceof Error ? error.message : '未知错误'}\n`,
  );
  process.exit(1);
});