// 销售单订单号生成：从 sales-record.query.ts 外移（该文件已超 400 行），
// 调用方继续从 sales-record.query 导入（re-export），引用路径保持稳定。
import { Prisma } from '@prisma/client';
import { getEndOfDay, getStartOfDay } from '../../commerce/commerce.utils';
import { formatShanghaiDate } from '../../../shared/shanghai-time.utils';
import { buildOrderNo, type SalesOrderNoVariant } from './sales-record.utils';

function buildSalesOrderSequenceLockKey(date: Date): number {
  // 锁 key 必须与订单号日期段同口径（上海营业日），否则跨零点会串号
  return Number(formatShanghaiDate(date.getTime()).replace(/-/g, ''));
}

export async function generateOrderNo(
  client: Prisma.TransactionClient,
  storeId: number,
  date: Date,
  variant: SalesOrderNoVariant = 'standard',
): Promise<string> {
  const dayStart = getStartOfDay(date.getTime());
  const dayEnd = getEndOfDay(date.getTime());
  // pg_advisory_xact_lock 在事务提交/回滚后自动释放，确保同日同店订单号串行生成。
  // 注意：若外层事务持续时间很长（如空间结账），其他并发创建请求会被阻塞直到事务结束。
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${storeId},
      ${buildSalesOrderSequenceLockKey(date)}
    )
  `;

  return buildOrderNo(
    date,
    (await queryMaxSerial(client, storeId, dayStart, dayEnd, variant)) + 1,
    variant,
  );
}

/**
 * 取当日指定号段已占用的最大序号，在 SQL 侧求 MAX，仅返回 1 行整数。
 *
 * 手工补录单与普通销售单各自独立计数（按 manual_entry 区分），
 * 避免两类号段互相挤占序号导致跳号。
 * 号段必须单调递增：用「当日已有最大序号 + 1」而非「当日单据条数 + 1」。
 * 按条数推导时，删除中间单据会让 count 回落，新单算出已被占用的序号，
 * 撞 @@unique([storeId, orderNo]) 导致后续录单持续失败。
 *
 * 原实现拉取当日全部 order_no 到 Node 侧逐个正则求最大值，此处改为 SQL 侧求值：
 * 网络传输与内存占用从 O(当日单据数) 降为 1 行，并缩短 pg_advisory_xact_lock
 * 的持锁时间（锁持有期间不再读取大结果集），缓解同日同店并发录单的锁等待。
 *
 * ⚠️ 必须按【数值】求 MAX，不能依赖 order_no 的字典序倒序 LIMIT 1：
 * 序号为零填充字符串，超过 999 后 "1000" 的字典序小于 "999"，
 * 字典序取最大值会倒退回已被占用的序号。
 */
async function queryMaxSerial(
  client: Prisma.TransactionClient,
  storeId: number,
  dayStart: Date,
  dayEnd: Date,
  variant: SalesOrderNoVariant,
): Promise<number> {
  // regexp_match 无匹配时返回 NULL，::integer 与 MAX 均忽略 NULL，
  // 由 COALESCE 兜底为 0（当日无单据 / 订单号格式异常时序号从 1 起算）。
  // 用 [0-9] 而非 \d，规避模板字符串与 SQL 的转义歧义。
  const rows = await client.$queryRaw<[{ max_serial: number | null }]>`
    SELECT COALESCE(
      MAX((regexp_match(order_no, '-([0-9]+)$'))[1]::integer),
      0
    )::integer AS max_serial
    FROM sale_orders
    WHERE store_id = ${storeId}
      AND manual_entry = ${variant === 'manual'}
      AND date >= ${dayStart}
      AND date <= ${dayEnd}
  `;

  const value = rows[0]?.max_serial;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}
