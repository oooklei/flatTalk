// 打包项目代码用于远程部署
import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const outFile = path.join(ROOT, 'flattalk-deploy.tar.gz');

// 用系统 tar 打包，排除不需要的文件
const excludeArgs = [
  '--exclude=node_modules',
  '--exclude=.git',
  '--exclude=flattalk-deploy.tar.gz',
  '--exclude=tests',
  '--exclude=coverage',
  '--exclude=.claude',
  '--exclude=.codebuddy',
  '--exclude=playwright-report',
  '--exclude=docs',
  '--exclude=*.log',
  '--exclude=tmp',
  '--exclude=temp',
  '--exclude=*.tmp',
  '--exclude=_*.txt',
  '--exclude=_*.mjs',
  '--exclude=scripts/test-*.mjs',
  '--exclude=scripts/check-*.mjs',
  '--exclude=data/sojourn-maps/*/route_data.json.bak',
].join(' ');

try {
  process.chdir(ROOT);
  execSync(`tar czf "${outFile}" ${excludeArgs} .`, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
  const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(`OK: ${outFile} (${sizeMB} MB)`);
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
