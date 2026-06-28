import type { ServerResponse } from 'node:http';

/**
 * CSV 特殊字符转义：字段内含逗号、双引号或换行时用双引号包裹。
 * 符合 RFC 4180 规范。
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str =
    typeof value === 'object'
      ? JSON.stringify(value)
      : String(value as string | number | boolean);

  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * 将一组值拼接为一行 CSV（以逗号分隔，以 \r\n 结尾）。
 */
export function toCsvLine(values: unknown[]): string {
  return values.map(escapeCsvField).join(',') + '\r\n';
}

/**
 * 为 HTTP 原始响应设置 CSV 下载响应头。
 * 使用 node:http ServerResponse 避免直接依赖 fastify 类型。
 */
export function setCsvDownloadHeaders(
  res: ServerResponse,
  filename: string,
): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(filename)}"`,
  );
  // 禁用压缩缓存，确保流式输出不被缓冲
  res.setHeader('Cache-Control', 'no-cache');
  // BOM 头让 Excel 正确识别 UTF-8 编码
  res.write('\uFEFF');
}

/**
 * 将扁平对象数组流式写入 CSV 响应。
 *
 * @param res     node:http ServerResponse（即 FastifyReply.raw）
 * @param headers CSV 表头列名
 * @param rows    数据行，每行是一个值数组，顺序与 headers 对应
 */
export function streamCsvRows(
  res: ServerResponse,
  headers: string[],
  rows: unknown[][],
): void {
  res.write(toCsvLine(headers));
  for (const row of rows) {
    res.write(toCsvLine(row));
  }
}

/**
 * 安全的 CSV 流式导出包装函数。
 *
 * 在 try/finally 中执行 CSV 写入，确保：
 * 1. 数据加载或写入期间抛出异常时，连接仍会被 `res.end()` 正确关闭，
 *    避免客户端无限等待挂起的 TCP 连接。
 * 2. 异常被重新抛出，交由 NestJS 全局异常过滤器统一处理。
 *
 * 注意：如果 `setCsvDownloadHeaders` 已经写入了 BOM 头和 CSV headers，
 * 异常过滤器尝试发送 JSON 错误响应时，客户端会收到混合格式数据。
 * 因此本函数在数据加载 **之后** 才设置 CSV headers，确保加载阶段的异常
 * 能被 NestJS 正常拦截并以 JSON 响应返回。
 *
 * @param res       node:http ServerResponse（即 FastifyReply.raw）
 * @param filename  下载文件名
 * @param headers   CSV 表头列名
 * @param rows      数据行
 */
export function safeStreamCsvExport(
  res: ServerResponse,
  filename: string,
  headers: string[],
  rows: unknown[][],
): void {
  try {
    setCsvDownloadHeaders(res, filename);
    streamCsvRows(res, headers, rows);
  } finally {
    res.end();
  }
}
