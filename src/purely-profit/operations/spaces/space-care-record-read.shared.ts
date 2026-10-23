import type { PrismaService } from '../../../prisma/prisma.service';
import {
  CARE_RECORD_ROW_SELECT,
  type SpaceCareRecordRow,
} from './space-care-record.mapper';
import {
  isTableFeeOnlyServiceName,
  resolveVoucherProductNamesBySessionIds,
} from './space-care-record-snapshot.shared';

/**
 * 护理档案读取链路共享层：B 端（space-care-records）与 C 端（club-care-records）
 * 的「记录行 → DTO」与「对比首尾」在此只有一份实现。
 *
 * 历史教训：两端曾各自复制约 45 行，C 端改分页契约时 e2e 只更新了 B 端、
 * 漏掉 C 端两条断言。取数列与 mapper 已共享（space-care-record.mapper.ts
 * 的注释即为此意），读取层一并对齐，后续口径调整只需改一处。
 */

/** 记录行 → DTO：两端 DTO 不同（隐私口径不同），由调用方注入映射函数 */
export type CareRecordDtoMapper<TDto> = (
  row: SpaceCareRecordRow,
  voucherProductName?: string,
) => TDto;

/**
 * 反查「台位费行」历史存量记录的团购商品名。
 *
 * 只有「剔除台位费段后项目名为空」的行才需要反查，正常记录不发额外查询。
 */
const resolveVoucherNames = async (
  db: PrismaService,
  storeId: number,
  rows: SpaceCareRecordRow[],
): Promise<Map<number, string>> =>
  resolveVoucherProductNamesBySessionIds(
    db,
    storeId,
    rows
      .filter((row) => isTableFeeOnlyServiceName(row.serviceName))
      .map((row) => row.sessionId),
  );

/**
 * 记录行 → DTO 列表（用于时间线分页，rows 来自 findMany，不含 null）。
 *
 * 附带历史存量「台位费行」的团购商品名兜底（无券时由 mapper 退「场地结账」）。
 */
export const mapCareRecordRows = async <TDto>(
  db: PrismaService,
  storeId: number,
  rows: SpaceCareRecordRow[],
  toDto: CareRecordDtoMapper<TDto>,
): Promise<TDto[]> => {
  if (rows.length === 0) {
    return [];
  }

  const voucherNames = await resolveVoucherNames(db, storeId, rows);

  return rows.map((row) => toDto(row, voucherNames.get(row.sessionId)));
};

/**
 * 效果对比的首尾记录：最早一次 / 最近一次**已补录照片**的护理。
 *
 * 走 `findFirst` + LIMIT 1，正反两个方向都能命中
 * `idx_care_records_customer_visit (customer_id, visit_at, id)`，免排序；
 * 两条查询与时间线分页并行，只多一次往返。没有照片记录时两侧均为 null，
 * 由前端回落到「已加载页内的候选」。
 *
 * 首尾**各自独立映射**：不先把两条行合并映射再按「过滤后的下标」取值——
 * 那种写法在两个 findFirst 的 where 将来分化时（如 earliest 增加 seq 限制），
 * 会把 latest 的记录静默塞进 earliest。这里一次反查覆盖两条行，既不少打
 * 查询，也不依赖「两个 where 恰好相同」的脆弱不变量。
 */
export const queryCareRecordCompareRange = async <TDto>(
  db: PrismaService,
  storeId: number,
  customerId: number,
  toDto: CareRecordDtoMapper<TDto>,
): Promise<{ earliest: TDto | null; latest: TDto | null }> => {
  const where = { storeId, customerId, photos: { isEmpty: false } };

  const [earliest, latest] = await Promise.all([
    db.careRecord.findFirst({
      where,
      orderBy: [{ visitAt: 'asc' }, { id: 'asc' }],
      select: CARE_RECORD_ROW_SELECT,
    }),
    db.careRecord.findFirst({
      where,
      orderBy: [{ visitAt: 'desc' }, { id: 'desc' }],
      select: CARE_RECORD_ROW_SELECT,
    }),
  ]);

  const presentRows = [earliest, latest].filter(
    (row): row is SpaceCareRecordRow => row !== null,
  );
  const voucherNames = await resolveVoucherNames(db, storeId, presentRows);

  return {
    earliest: earliest
      ? toDto(earliest, voucherNames.get(earliest.sessionId))
      : null,
    latest: latest ? toDto(latest, voucherNames.get(latest.sessionId)) : null,
  };
};
