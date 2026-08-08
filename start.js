// 一键启动：安装依赖（如缺）→ 构建前端 → 启动后端（单端口 :3001）
// 用法：node start.js   或   npm start（根目录）

import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd) => {
  console.log(`\n> ${cmd} ${args.join(' ')}  (${cwd})`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) { console.error(`命令失败：${cmd}`); process.exit(r.status ?? 1); }
};

const serverDeps = existsSync(join(__dirname, 'server', 'node_modules'));
const webDeps = existsSync(join(__dirname, 'web', 'node_modules'));
const webDist = existsSync(join(__dirname, 'web', 'dist'));

if (!serverDeps) run(npm, ['install'], join(__dirname, 'server'));
if (!webDeps) run(npm, ['install'], join(__dirname, 'web'));
if (!webDist) run(npm, ['run', 'build'], join(__dirname, 'web'));

console.log('\n启动 BEECOUNT（http://localhost:3001）…');
const child = spawn(process.execPath, [join(__dirname, 'server', 'src', 'index.js')], {
  cwd: join(__dirname, 'server'),
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
