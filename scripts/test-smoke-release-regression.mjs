import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

function fail(message) {
  throw new Error(message);
}

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

function expectIncludes(content, snippet, label) {
  if (!content.includes(snippet)) {
    fail(`${label} 缺少片段: ${snippet}`);
  }
}

function runCommand(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    ...options,
  });

  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(`${label} 失败\n${output}`);
  }

  return `${result.stdout || ''}${result.stderr || ''}`;
}

function main() {
  const packageJson = JSON.parse(readProjectFile('package.json'));
  const verifyScript = readProjectFile('verify-api-live.sh');
  const releaseScript = readProjectFile('scripts/release-execute.sh');
  const prepareScript = readProjectFile('scripts/seed-owner.mjs');
  const tokenScript = readProjectFile('scripts/generate-smoke-token.mjs');

  if (
    packageJson.scripts['smoke:prepare:regression'] !==
    'node ./scripts/test-smoke-release-regression.mjs'
  ) {
    fail('package.json 未正确注册 smoke:prepare:regression');
  }

  if (
    packageJson.scripts['release:execute:dry-run'] !==
    'RELEASE_DRY_RUN=true bash ./scripts/release-execute.sh'
  ) {
    fail('package.json 未正确注册 release:execute:dry-run');
  }

  expectIncludes(prepareScript, 'SMOKE_STORE_ID', 'smoke prepare 脚本');
  expectIncludes(prepareScript, 'SMOKE_PROFIT_REPORT_PATH', 'smoke prepare 脚本');
  expectIncludes(tokenScript, 'SMOKE_LOGIN_EMAIL', 'smoke token 脚本');
  expectIncludes(tokenScript, 'configuredStoreId', 'smoke token 脚本');
  expectIncludes(tokenScript, 'SMOKE_PROFIT_REPORT_PATH', 'smoke token 脚本');
  expectIncludes(verifyScript, 'apply_smoke_metadata()', 'smoke live 脚本');
  expectIncludes(verifyScript, 'ensure_profit_report_path()', 'smoke live 脚本');
  expectIncludes(releaseScript, 'run_smoke_prepare_command()', 'release 脚本');
  expectIncludes(releaseScript, 'apply_smoke_metadata()', 'release 脚本');

  runCommand('node', ['--check', './scripts/seed-owner.mjs'], '校验 smoke prepare 语法');
  runCommand('node', ['--check', './scripts/generate-smoke-token.mjs'], '校验 smoke token 语法');
  runCommand('node', ['--check', './scripts/test-smoke-release-regression.mjs'], '校验回归脚本语法');
  runCommand('bash', ['-n', './verify-api-live.sh'], '校验 smoke live 语法');
  runCommand('bash', ['-n', './scripts/release-execute.sh'], '校验 release 脚本语法');

  const dryRunOutput = runCommand(
    'pnpm',
    ['run', 'release:execute:dry-run'],
    '执行 release:execute:dry-run',
  );
  expectIncludes(dryRunOutput, '==> 发布前预检查', 'release dry-run 输出');
  expectIncludes(dryRunOutput, 'DRY-RUN: pnpm run release:precheck', 'release dry-run 输出');
  expectIncludes(dryRunOutput, 'Smoke prepare command: pnpm run smoke:prepare', 'release dry-run 输出');
  expectIncludes(dryRunOutput, '==> 准备 smoke 数据', 'release dry-run 输出');
  expectIncludes(dryRunOutput, 'DRY-RUN: pnpm run smoke:prepare', 'release dry-run 输出');
  expectIncludes(dryRunOutput, '==> 执行上线后 smoke 检查', 'release dry-run 输出');

  console.log('smoke/release regression checks passed');
}

main();
