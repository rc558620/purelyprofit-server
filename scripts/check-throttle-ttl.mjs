import fs from 'fs';
import path from 'path';

/**
 * 限流 ttl 单位静态检查器
 *
 * 背景：@nestjs/throttler v5+ 的 ttl 单位是**毫秒**，写成 `ttl: 60` 只有 60ms 窗口，
 * 等于限流事实上不生效；且 @Throttle 会覆盖 ThrottlerModule 的全局默认配置，
 * 这类写法会让路由连全局的 100 次/60s 都失去保护。
 *
 * 规则：src 下所有 TypeScript 文件中，@Throttle({ ... }) 字面量里的 ttl
 * 若为数字且 < 1000，判定为违规并打印 文件:行号，退出码 1。
 * 非数字字面量（变量 / 表达式）无法静态判定，仅输出告警，不阻断。
 */

const SRC_DIR = path.resolve(process.cwd(), 'src');
const MIN_TTL_MS = 1000;

const errors = [];
const warnings = [];

/** 递归收集 src 下的 .ts 文件（跳过 node_modules 与产物目录）。 */
const collectTsFiles = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'coverage'].includes(entry.name)) {
        continue;
      }
      files.push(...collectTsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
};

/** 从 `(` 位置开始做括号配对，返回 @Throttle(...) 的参数文本结束下标（不含）。 */
const findClosingParen = (content, openIndex) => {
  let depth = 0;
  for (let i = openIndex; i < content.length; i += 1) {
    const char = content[i];
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
};

/** 把 1 起始的行号换算成「文件:行号」所需的偏移量。 */
const lineOfIndex = (content, index) => {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content[i] === '\n') {
      line += 1;
    }
  }
  return line;
};

/** 解析可静态判定的数字字面量（支持 60_000 / 0x3e8 / 6e4），无法判定返回 null。 */
const parseNumericLiteral = (raw) => {
  const value = raw.trim();
  if (
    !/^(0[xX][0-9a-fA-F_]+|[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9]+)?)$/.test(
      value,
    )
  ) {
    return null;
  }
  const normalized = value.replace(/_/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

/** 检查单个 @Throttle 参数块内的所有 ttl。 */
const inspectThrottleBlock = (relativeFile, content, blockText, blockStart) => {
  const ttlPattern = /\bttl\s*:\s*([^,}\n]+)/g;
  let match = ttlPattern.exec(blockText);

  while (match !== null) {
    const rawValue = match[1];
    const valueIndex = blockStart + match.index;
    const location = `${relativeFile}:${lineOfIndex(content, valueIndex)}`;
    const ttlMs = parseNumericLiteral(rawValue);

    if (ttlMs === null) {
      warnings.push(
        `${location}  ttl=${rawValue.trim()}（非数字字面量，无法静态判定单位，请人工确认是毫秒）`,
      );
    } else if (ttlMs < MIN_TTL_MS) {
      errors.push(
        `${location}  ttl=${rawValue.trim()}（${ttlMs}ms < ${MIN_TTL_MS}ms）—— @nestjs/throttler 的 ttl 单位是毫秒，60 秒应写 60_000`,
      );
    }

    match = ttlPattern.exec(blockText);
  }
};

/** 扫描单个文件里的全部 @Throttle 装饰器。 */
const inspectFile = (absoluteFile) => {
  const relativeFile = path.relative(process.cwd(), absoluteFile);
  const content = fs.readFileSync(absoluteFile, 'utf-8');
  let cursor = content.indexOf('@Throttle(');
  let blockCount = 0;

  while (cursor !== -1) {
    const openIndex = cursor + '@Throttle'.length;
    const closeIndex = findClosingParen(content, openIndex);
    if (closeIndex === -1) {
      errors.push(
        `${relativeFile}:${lineOfIndex(content, cursor)}  @Throttle 括号未闭合，无法解析`,
      );
      break;
    }

    blockCount += 1;
    const blockText = content.slice(openIndex + 1, closeIndex);
    inspectThrottleBlock(relativeFile, content, blockText, openIndex + 1);
    cursor = content.indexOf('@Throttle(', closeIndex);
  }

  return blockCount;
};

const files = collectTsFiles(SRC_DIR);
let totalBlocks = 0;

for (const file of files) {
  totalBlocks += inspectFile(file);
}

/** 自检：扫不到任何 @Throttle 说明路径或解析逻辑失效，不能静默通过。 */
if (totalBlocks === 0) {
  console.error(
    '❌ 未在 src 下扫描到任何 @Throttle，检查脚本路径或解析逻辑是否正确',
  );
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn(`⚠️ ${warnings.length} 处 ttl 无法静态判定：`);
  warnings.forEach((warning) => console.warn(`   - ${warning}`));
}

if (errors.length > 0) {
  console.error(`\n❌ 发现 ${errors.length} 处 ttl 单位缺陷：`);
  errors.forEach((error) => console.error(`   - ${error}`));
  process.exit(1);
}

console.log(
  `✅ 限流 ttl 检查通过：扫描 ${files.length} 个文件、${totalBlocks} 处 @Throttle，ttl 均不小于 ${MIN_TTL_MS}ms`,
);
process.exit(0);
