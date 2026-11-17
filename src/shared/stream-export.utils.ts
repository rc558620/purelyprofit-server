import type { ServerResponse } from 'node:http';

/**
 * CSV 特殊字符转义：字段内含逗号、双引号或换行时用双引号包裹。
 * 符合 RFC 4180 规范。
 */
/**
 * CSV 公式注入防护：以 = + - @ 开头且第二个字符不是数字的文本字段，
 * 在 Excel/WPS 中会被当作公式执行。仅对字符串生效，避免把负数金额
 * （number 类型的 -3）误伤成文本。
 */
function neutralizeCsvFormula(str: string, isTextValue: boolean): string {
  if (!isTextValue) {
    return str;
  }
  if (!/^[=+\-@]/.test(str)) {
    return str;
  }
  // "-3" / "-2.5" 这类本身就是数字文本，不需要处理
  if (/^-[0-9]/.test(str)) {
    return str;
  }
  return `'${str}`;
}

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const isTextValue = typeof value === 'string';
  const str =
    typeof value === 'object'
      ? JSON.stringify(value)
      : String(value as string | number | boolean);

  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${neutralizeCsvFormula(str, isTextValue).replace(/"/g, '""')}"`;
  }

  return neutralizeCsvFormula(str, isTextValue);
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
  rows: Iterable<unknown[]>,
  prefixRows?: Iterable<unknown[]>,
): void {
  if (prefixRows) {
    for (const row of prefixRows) {
      res.write(toCsvLine(row));
    }
  }
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
  rows: Iterable<unknown[]>,
  prefixRows?: Iterable<unknown[]>,
): void {
  try {
    setCsvDownloadHeaders(res, filename);
    streamCsvRows(res, headers, rows, prefixRows);
  } finally {
    res.end();
  }
}

/**
 * 异步分批数据源的 CSV 流式导出。
 *
 * 与 `safeStreamCsvExport` 的区别：数据行由异步迭代器逐批产出（如分批查库），
 * 内存占用只与单批大小相关，不再需要把全量行先读进内存。
 *
 * 兼容错误处理约定：**先取第一批**再写响应头，若首批加载失败（鉴权、SQL 异常）
 * 仍未被写入任何字节，全局异常过滤器可以正常返回 JSON 错误；
 * 只有进入流式阶段后的异常才只能以断流处理。
 */
export async function safeStreamCsvExportAsync(
  res: ServerResponse,
  filename: string,
  headers: string[],
  rows: AsyncIterable<unknown[]>,
): Promise<void> {
  const iterator = rows[Symbol.asyncIterator]();
  // 预取首批：加载阶段异常发生在写响应头之前，仍可转成 JSON 错误响应
  let current = await iterator.next();
  try {
    setCsvDownloadHeaders(res, filename);
    await writeCsvChunk(res, toCsvLine(headers));
    while (!current.done) {
      // 客户端主动断开后停止继续拉库，避免“导出中途取消”仍在后台翻页取数
      if (res.destroyed || res.writableEnded) {
        return;
      }
      await writeCsvChunk(res, toCsvLine(current.value));
      current = await iterator.next();
    }
  } finally {
    res.end();
  }
}

/**
 * 写入一块数据并处理背压。
 *
 * `res.write` 返回 false 表示内核/内部缓冲已满，继续硬写只会把剩余内容堆进内存，
 * 大导出时内存仍会随行数线性增长。这里等待 drain（或连接关闭）后再继续，
 * 让「分批从库里取」真正对应「分批写到网络」。
 */
async function writeCsvChunk(
  res: ServerResponse,
  chunk: string,
): Promise<void> {
  const flushed = res.write(chunk);
  // 仅真实 http 流会返回 boolean；测试/自定义 response 返回 undefined 时不做背压等待
  if (flushed !== false) {
    return;
  }
  await new Promise<void>((resolve) => {
    const settle = (): void => {
      res.off('drain', settle);
      res.off('close', settle);
      resolve();
    };
    res.once('drain', settle);
    res.once('close', settle);
  });
}
