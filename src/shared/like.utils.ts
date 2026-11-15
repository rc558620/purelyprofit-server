// LIKE / ILIKE 模式转义（全局唯一实现，纯函数，不持有 IO 依赖）

/**
 * 转义 LIKE / ILIKE 模式串里的元字符，把用户输入还原成字面量。
 *
 * 为什么必须转义：
 * 列表搜索统一写成 `column ILIKE '%' || keyword || '%'`，而 `%`（任意长度）、
 * `_`（任意单字符）、`\`（转义符本身）都是 LIKE 的模式元字符。不转义会有三类后果：
 * 1. 搜 `%` —— 模式退化成 `'%%%'`，等价于「匹配一切」，全表扫描且语义错乱；
 * 2. 搜 `_` —— 变成单字符通配，用户以为在搜下划线，实际命中任意字符；
 * 3. 搜 `\` —— 反斜杠后跟普通字符会构成非法转义序列，PostgreSQL 直接报错。
 *
 * 转义口径与 Prisma `contains` 一致（Prisma 同样以反斜杠作转义符），
 * 这样原生 SQL 路径与 Prisma 查询路径对同一关键词的匹配结果完全同源。
 */
export function escapeLikePattern(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 构造 `contains` 语义的模式串：`%` + 转义后的关键词 + `%`。
 *
 * @param keyword 用户输入；`null` / `undefined` / 空串一律返回 `null`，
 *                调用方据此跳过该过滤条件（避免拼出 `'%%'` 这种「匹配一切」的模式）。
 *
 * 注意：**不做 trim**，保持各域既有行为逐字节一致——
 * 需要归一空白的域在 DTO 层已用 `transformOptionalKeyword` 处理，
 * 工具函数不重复加工，避免同一输入在两条路径上得到不同的模式串。
 *
 * 原生 SQL 里请配合显式 `ESCAPE` 使用：
 * `column ILIKE ${pattern} ESCAPE '\\'`（模板字符串里的 `\\` 编译为 SQL 的单个反斜杠）。
 * PostgreSQL 的 LIKE 默认 ESCAPE 确实是反斜杠，但显式书写更清晰，
 * 也能避免 standard_conforming_strings 或默认值变化时行为静默漂移。
 */
export function buildContainsPattern(keyword?: string | null): string | null {
  if (keyword === undefined || keyword === null || keyword === '') {
    return null;
  }
  return `%${escapeLikePattern(keyword)}%`;
}
