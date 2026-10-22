import type { Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import {
  stripTableFeeSegments,
  EMPTY_SERVICE_NAME_FALLBACK,
} from './space-care-record-snapshot.shared';
import type { SpaceCareRecordDto } from './dto/space-care-record.dto';

/**
 * 护理记录的统一取数列。
 *
 * B 端与 C 端共用同一份 select，保证两侧字段口径同源；
 * C 端的隐私裁剪发生在 `toClubCareRecordDto`，而不是各自写一份 select——
 * 避免将来加字段时只在其中一端补上、另一端静默漏掉。
 *
 * sessionId 不对外输出，仅供读取链路反查团购商品名（台位费行历史数据兜底）。
 */
export const CARE_RECORD_ROW_SELECT = {
  id: true,
  customerId: true,
  sessionId: true,
  seq: true,
  visitAt: true,
  serviceName: true,
  amountCents: true,
  content: true,
  photos: true,
  technicianName: true,
  updatedAt: true,
} satisfies Prisma.CareRecordSelect;

export type SpaceCareRecordRow = Prisma.CareRecordGetPayload<{
  select: typeof CARE_RECORD_ROW_SELECT;
}>;

/**
 * 解析对外展示的项目名：先剔除名称中的台位费段（如「台位费 1分钟、助眠疗愈」
 * →「助眠疗愈」）；剔除后无剩余项目的历史存量记录用团购商品名兜底，
 * 无券可查时退到「场地结账」。
 */
function resolveDisplayServiceName(
  row: Pick<SpaceCareRecordRow, 'serviceName'>,
  voucherProductName?: string,
): string {
  const stripped = stripTableFeeSegments(row.serviceName);
  if (stripped) {
    return stripped;
  }
  return voucherProductName?.trim() || EMPTY_SERVICE_NAME_FALLBACK;
}

/** B 端护理记录：全字段输出 */
export function toSpaceCareRecordDto(
  row: SpaceCareRecordRow,
  voucherProductName?: string,
): SpaceCareRecordDto {
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    seq: row.seq,
    visitAt: row.visitAt.getTime(),
    serviceName: resolveDisplayServiceName(row, voucherProductName),
    // DB 存分，对外元：全仓唯一口径，禁止手写 /100
    amountYuan: Money.fromDbCents(row.amountCents).toOutputYuan(),
    content: row.content,
    photos: row.photos,
    ...(row.technicianName ? { technicianName: row.technicianName } : {}),
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * C 端（purelyClub）可见字段白名单。
 *
 * 隐私红线：只暴露会员本人需要查看的护理内容，**不含** customerId、
 * 操作人、来源场次等任何商家内部字段。接口层不得自行扩展该结构。
 */
export interface ClubCareRecordFields {
  id: string;
  seq: number;
  visitAt: number;
  serviceName: string;
  amountYuan: number;
  content: string;
  photos: string[];
  technicianName?: string;
}

/** C 端护理记录：按白名单裁剪后输出 */
export function toClubCareRecordDto(
  row: SpaceCareRecordRow,
  voucherProductName?: string,
): ClubCareRecordFields {
  return {
    id: String(row.id),
    seq: row.seq,
    visitAt: row.visitAt.getTime(),
    serviceName: resolveDisplayServiceName(row, voucherProductName),
    amountYuan: Money.fromDbCents(row.amountCents).toOutputYuan(),
    content: row.content,
    photos: row.photos,
    ...(row.technicianName ? { technicianName: row.technicianName } : {}),
  };
}
