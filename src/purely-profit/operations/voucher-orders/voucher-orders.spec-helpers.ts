// 团购券订单服务测试夹具：Prisma/依赖 mock 组装 + 游标翻页内存模拟
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ClubVoucherOrderRefundService } from '../../../purely-club/voucher-orders/club-voucher-order-refund.service';
import { VoucherOrdersService } from './voucher-orders.service';

/** 列表查询用到的 Prisma 委托 mock */
export interface VoucherOrderPrismaMock {
  clubVoucherOrder: {
    updateMany: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
}

/** 测试用服务实例与依赖 mock */
export interface VoucherOrdersTestHarness {
  service: VoucherOrdersService;
  prisma: VoucherOrderPrismaMock;
  realtime: { publishVoucherOrderConfirmed: jest.Mock };
}

/** 当前登录用户：服务内只透传给权限服务，用空对象即可 */
export const voucherOrdersSpecUser = {} as AuthenticatedUser;

/** 组装带 mock 依赖的 VoucherOrdersService 实例 */
export const createVoucherOrdersTestService =
  async (): Promise<VoucherOrdersTestHarness> => {
    const prisma: VoucherOrderPrismaMock = {
      clubVoucherOrder: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const realtime = {
      publishVoucherOrderConfirmed: jest.fn(),
      publishVoucherOrderStatusChanged: jest.fn(),
    };
    const commerceAccess = {
      resolveSingleStoreId: jest.fn().mockResolvedValue(1),
      findOperatorStaffIdForStore: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoucherOrdersService,
        {
          provide: PrismaService,
          useValue: {
            ...prisma,
            staff: { findUnique: jest.fn().mockResolvedValue(null) },
            store: { findUnique: jest.fn().mockResolvedValue(null) },
          },
        },
        { provide: CommerceAccessService, useValue: commerceAccess },
        { provide: ScanOrderingRealtimeService, useValue: realtime },
        {
          provide: ClubVoucherOrderRefundService,
          useValue: { rejectVoucherOrderByMerchant: jest.fn() },
        },
      ],
    }).compile();

    return { service: module.get(VoucherOrdersService), prisma, realtime };
  };

/** 列表行样本：字段与 VOUCHER_ORDER_MANAGE_LIST_SELECT 对齐，供列表响应映射使用 */
export interface FakeListRow {
  id: number;
  orderNo: string;
  voucherCode: string | null;
  guestName: string | null;
  guestPhone: string | null;
  categoryName: string | null;
  productName: string;
  quantity: number;
  remark: string | null;
  paidAmountFen: number;
  status: string;
  usedSessionId: number | null;
  createdAt: Date;
  confirmedAt: Date | null;
  verifyAt: Date | null;
  confirmedByStaffName: string | null;
  confirmedByStaffRole: string | null;
  rejectedAt: Date | null;
  refundAt: Date | null;
  rejectedByStaffName: string | null;
  rejectedByStaffRole: string | null;
  product: { image: string | null };
}

/** 构造一条列表行；同一 createdAt 传多次用于验证同值行翻页 */
export const buildVoucherOrderListRow = (
  id: number,
  createdAt: Date,
): FakeListRow => ({
  id,
  orderNo: `VO-${id}`,
  voucherCode: null,
  guestName: null,
  guestPhone: null,
  categoryName: null,
  productName: '团购券',
  quantity: 1,
  remark: null,
  paidAmountFen: 1000,
  status: 'pending',
  usedSessionId: null,
  createdAt,
  confirmedAt: null,
  verifyAt: null,
  confirmedByStaffName: null,
  confirmedByStaffRole: null,
  rejectedAt: null,
  refundAt: null,
  rejectedByStaffName: null,
  rejectedByStaffRole: null,
  product: { image: null },
});

/** 列表查询参数（只声明内存模拟真正用到的字段） */
export interface FakeListQueryArgs {
  where: { AND?: Array<{ OR?: Array<Record<string, unknown>> }> };
  take: number;
  select: Record<string, boolean>;
}

/** 时间区间条件守卫（游标 where 的两个分支形态不同，需要区分） */
const isDateRange = (value: unknown): value is { lt: Date } =>
  typeof value === 'object' && value !== null && 'lt' in value;

/** 判断行是否严格排在游标之后（与 buildVoucherOrderCursorWhere 的语义一一对应） */
const isAfterCursor = (
  row: FakeListRow,
  cursorWhere: { OR?: Array<Record<string, unknown>> },
): boolean =>
  (cursorWhere.OR ?? []).some((branch) => {
    const createdAt = branch.createdAt;
    if (branch.id !== undefined) {
      const idCondition = branch.id as { lt: number };
      return (
        createdAt instanceof Date &&
        createdAt.getTime() === row.createdAt.getTime() &&
        row.id < idCondition.lt
      );
    }
    return (
      isDateRange(createdAt) && row.createdAt.getTime() < createdAt.lt.getTime()
    );
  });

/**
 * 内存模拟列表查询：只实现游标条件 + 排序 + take。
 *
 * 时间范围与关键词和游标语义正交，这里不模拟，避免用例被「今天」的默认时间窗绑架。
 */
export const emulateVoucherOrderListQuery = (
  dataset: FakeListRow[],
  args: FakeListQueryArgs,
): FakeListRow[] => {
  const cursorWhere = args.where.AND?.[1];
  const rows = cursorWhere
    ? dataset.filter((row) => isAfterCursor(row, cursorWhere))
    : [...dataset];
  rows.sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() ||
      right.id - left.id,
  );
  return rows.slice(0, args.take);
};
