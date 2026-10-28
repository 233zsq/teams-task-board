import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from '../config';
import { openDatabase } from './connection';
import { assertSchemaCompatible } from './migrations';
import { claimLegacyProjects } from '../modules/projects/claim';

const root = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(root, '.env') });
const [username, confirmation] = process.argv.slice(2);
if (!username || confirmation !== '--all-unowned' || !/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
  process.stderr.write('用法：node backend/dist/db/claim-legacy.js <已注册用户名> --all-unowned\n仅接管尚无负责人的历史项目；请先备份数据库。\n');
  process.exitCode = 1;
} else {
  const config = loadConfig({ DATABASE_PATH: process.env.DATABASE_PATH }, root);
  const db = openDatabase(config.databasePath);
  try {
    assertSchemaCompatible(db.raw, path.resolve(__dirname, '../../migrations'));
    const count = claimLegacyProjects(db.raw, username.toLowerCase());
    process.stdout.write(`历史项目接管完成：${count} 个。既有任务及其发布者记录保持不变。\n`);
  } catch (error) {
    process.stderr.write(`接管失败：${error instanceof Error ? error.message : '数据库不可用'}\n`);
    process.exitCode = 1;
  } finally { db.close(); }
}
