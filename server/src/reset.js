// 重置数据库：清空全部表数据并重新播种（不删除文件，避免文件锁）
import { db } from './db.js';
import { seedIfEmpty } from './seed.js';

const tables = ['transaction_tags', 'transactions', 'budgets', 'tags', 'categories', 'accounts', 'ledgers'];
db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN;');
try {
  for (const t of tables) db.exec(`DELETE FROM ${t};`);
  db.exec('DELETE FROM sqlite_sequence;'); // 重置自增 ID
  db.exec('COMMIT;');
} catch (e) {
  db.exec('ROLLBACK;');
  throw e;
}
db.exec('PRAGMA foreign_keys = ON;');

// 重新播种
seedIfEmpty();
console.log('数据库已重置并重新写入演示数据。');
