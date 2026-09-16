/**
 * 原生 SQL 时间写入口径检查（CI 用）
 *
 * 背景：库内历史表的时间列是 TIMESTAMP WITHOUT TIME ZONE，列默认值 CURRENT_TIMESTAMP 取
 * 数据库会话时区的墙钟，而 Prisma/驱动按 UTC 解释 naive 值。一旦某段写入 SQL 依赖会话时区
 * （`NOW()` / `CURRENT_TIMESTAMP` 未显式转 UTC，或 INSERT 漏传 created_at 走列默认值），
 * 读回就会偏移 8 小时，且编译器与测试都不会报错。
 *
 * 本脚本只检查「写入类」SQL（INSERT / UPDATE / DELETE），避免误报只读查询里的时区换算：
 *   R1 SET/VALUES 里的 NOW() / CURRENT_TIMESTAMP 未带 `AT TIME ZONE 'UTC'` → 失败
 *   R2 INSERT 语句中出现了其他时间列却缺 created_at → 失败（提示显式传 UTC 墙钟）
 *
 * 用法：pnpm run sql:tz:check
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

/** 视为原生 SQL 的前缀（Prisma raw 与 Prisma.sql 构造器） */
const SQL_PREFIX = /\$queryRaw(?:Unsafe)?|\$executeRaw(?:Unsafe)?|Prisma\.(?:sql|raw|join)/;

const WRITE_STMT = /^\s*(INSERT|UPDATE|DELETE)/i;
// 前置用 (?<![\w.]) 而非 \b：SQL 模板里常插 JS 表达式（如 ${Date.now()} / ${String(Date.now())}），
// \b 会把 ".now()" 里的 now() 当成 SQL NOW() 而误报；真实 SQL 写法 NOW() 的前置字符不会是标识符或点。
// 后置用 (?!\w) 而非 \b：NOW() 的右括号后面跟换行/空格时 \b 不成立，会导致漏报
const NOW_FN =
  /(?<![\w.])(NOW\s*\(\s*\)|CURRENT_TIMESTAMP|CURRENT_DATE|LOCALTIMESTAMP)(?!\w)/i;
const UTC_CAST = /AT\s+TIME\s+ZONE\s+'UTC'/i;

/** 收集所有 .ts 文件（跳过 spec / 测试辅助） */
function collectTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.includes('.spec.')) continue;
    out.push(full);
  }
  return out;
}

/** 抽取紧随 SQL 前缀之后的模板字符串内容（含起止位置，便于定位行号） */
function extractSqlTemplates(source) {
  const templates = [];
  const prefixRe = new RegExp(SQL_PREFIX.source, 'g');
  let match;
  while ((match = prefixRe.exec(source)) !== null) {
    // 允许前缀与反引号之间存在空白 / 泛型
    const rest = source.slice(match.index + match[0].length);
    const gap = rest.match(/^[^`]*/);
    const backtickIdx = gap ? gap[0].length : 0;
    const openIdx = match.index + match[0].length + backtickIdx;
    if (source[openIdx] !== '`') continue;

    let i = openIdx + 1;
    let content = '';
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        content += source[i] + source[i + 1];
        i += 2;
        continue;
      }
      if (ch === '`') break;
      content += ch;
      i += 1;
    }
    const line = source.slice(0, openIdx).split('\n').length;
    templates.push({ content, line });
    prefixRe.lastIndex = i;
  }
  return templates;
}

const findings = [];

for (const file of collectTsFiles(SRC_DIR)) {
  const source = readFileSync(file, 'utf8');
  for (const { content, line } of extractSqlTemplates(source)) {
    if (!WRITE_STMT.test(content)) continue;
    if (!NOW_FN.test(content)) continue;

    if (!UTC_CAST.test(content)) {
      findings.push({
        file: relative(ROOT, file),
        line,
        rule: 'R1',
        message:
          '写入类 SQL 使用了 NOW()/CURRENT_TIMESTAMP 等会话时区函数，但未显式 AT TIME ZONE \'UTC\'',
      });
    }

    // R2：INSERT 列清单里带 updated_at/created_at 语义却没有 created_at
    const isInsert = /^\s*INSERT/i.test(content);
    const columnList = content.match(/^\s*INSERT\s+INTO\s+[^\s(]+\s*\(([^)]*)\)/is);
    if (isInsert && columnList) {
      const cols = columnList[1]
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      if (cols.includes('updated_at') && !cols.includes('created_at')) {
        findings.push({
          file: relative(ROOT, file),
          line,
          rule: 'R2',
          message: 'INSERT 指定了 updated_at 却未显式写 created_at（会走列默认值 CURRENT_TIMESTAMP）',
        });
      }
    }
  }
}

if (findings.length > 0) {
  console.error('✗ 原生 SQL 时间口径检查未通过：\n');
  for (const finding of findings) {
    console.error(`  [${finding.rule}] ${finding.file}:${finding.line}`);
    console.error(`    ${finding.message}\n`);
  }
  console.error('修复方式：写入时间列时显式写 UTC 墙钟，例如：');
  console.error(`  SET updated_at = NOW() AT TIME ZONE 'UTC'`);
  console.error(`  INSERT INTO t (..., created_at) VALUES (..., NOW() AT TIME ZONE 'UTC')`);
  process.exit(1);
}

console.log('✓ 原生 SQL 时间口径检查通过（写入类 SQL 均显式使用 UTC 墙钟）');
