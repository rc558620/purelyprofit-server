// 商家端团购券订单管理服务：当前门店分页列表 / 确认（仅记录不改变状态）/ 拒绝（退款链路 + 广播）
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ClubVoucherOrderRefundService } from '../../../purely-club/voucher-orders/club-voucher-order-refund.service';
import {
  addShanghaiDays,
  getShanghaiDayStartMs,
  makeShanghaiMs,
} from '../../../shared/shanghai-time.utils';
import type {
  QueryVoucherOrdersDto,
  VoucherOrderListItemDto,
  VoucherOrderListResponseDto,
} from './dto/voucher-order-management.dto';
import { VoucherOrderStatusFilter } from './dto/voucher-order-management.dto';
import { VoucherOrderTimePreset } from './dto/voucher-order-management.dto';

/** 商家端确认操作结果 */
export interface VoucherOrderConfirmResult {
  orderNo: string;
  /** 确认时间 ISO */
  confirmedAt: string;
  /** 确认操作员姓名 */
  confirmedByStaffName: string | null;
  /** 当前订单状态（确认不改变状态，仍为 pending） */
  status: 'pending';
}

/** 商家端拒绝操作结果 */
export interface VoucherOrderRejectResult {
  orderNo: string;
  status: 'refunded';
  refundAt: string;
  rejectedAt: string;
}

/** 可操作状态：确认/拒绝仅对 pending 订单开放 */
const CONFIRMABLE_STATUS = ['pending'] as const;

@Injectable()
export class VoucherOrdersService {
  private readonly logger = new Logger(VoucherOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly refundService: ClubVoucherOrderRefundService,
  ) {}

  /** 当前门店团购券订单分页列表（按 createdAt desc） */
  async listVoucherOrders(
    user: AuthenticatedUser,
    query: QueryVoucherOrdersDto,
  ): Promise<VoucherOrderListResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'space:view',
      '无权查看该门店团购券订单',
    );
    const timeRange = this.buildTimeRange(query);
    const where = {
      storeId,
      ...(query.status && query.status !== VoucherOrderStatusFilter.ALL
        ? { status: query.status }
        : {}),
      ...(timeRange ? { createdAt: timeRange } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.clubVoucherOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.offset ?? 0,
        take: query.limit ?? 20,
        // 商品图片：取营销商品当前图（商品被删后为 null，前端占位展示）
        include: { product: { select: { image: true } } },
      }),
      this.prisma.clubVoucherOrder.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toListItem(row)),
      total,
    };
  }

  /** 确认订单：仅记录 confirmedAt + confirmedByStaffName，订单状态不变（幂等：已确认直接返回） */
  async confirmVoucherOrder(
    user: AuthenticatedUser,
    orderNo: string,
  ): Promise<VoucherOrderConfirmResult> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'operation-entry:create',
      '无权确认该门店团购券订单',
    );
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo, storeId },
    });
    if (!order) {
      throw new NotFoundException('团购券订单不存在');
    }
    this.assertPendingStatus(order.status, '确认');

    // 幂等：已确认过直接返回当前确认信息，不重复写入
    if (order.confirmedAt !== null) {
      return {
        orderNo: order.orderNo,
        confirmedAt: order.confirmedAt.toISOString(),
        confirmedByStaffName: order.confirmedByStaffName,
        status: 'pending',
      };
    }

    const confirmedByStaffName = await this.resolveOperatorNameSnapshot(
      user,
      storeId,
    );
    const confirmedAt = new Date();

    await this.prisma.clubVoucherOrder.update({
      where: { id: order.id },
      data: {
        confirmedAt,
        confirmedByStaffName,
      },
    });

    this.logger.log(
      `商家确认团购券订单: orderNo=${order.orderNo}, confirmedBy=${confirmedByStaffName}, 状态保持 pending`,
    );
    // 广播确认事件，供其他商家端打开查看订单页时刷新
    this.realtimeService.publishVoucherOrderConfirmed({
      storeId,
      orderNo: order.orderNo,
      confirmedAt: confirmedAt.toISOString(),
      confirmedByStaffName: confirmedByStaffName ?? '',
    });

    return {
      orderNo: order.orderNo,
      confirmedAt: confirmedAt.toISOString(),
      confirmedByStaffName,
      status: 'pending',
    };
  }

  /** 拒绝订单：仅 pending（已确认也可拒）→ 退款链路 + 记录拒绝信息 + 广播 status_changed(refunded) */
  async rejectVoucherOrder(
    user: AuthenticatedUser,
    orderNo: string,
  ): Promise<VoucherOrderRejectResult> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'operation-entry:create',
      '无权拒绝该门店团购券订单',
    );
    const rejectedByStaffName = await this.resolveOperatorNameSnapshot(
      user,
      storeId,
    );

    // 复用退款核心链路：微信原路退回 + 积分返还 + 库存回补 + 写 rejectedAt/rejectedByStaffName（幂等）
    const result = await this.refundService.rejectVoucherOrderByMerchant({
      storeId,
      orderNo,
      rejectedByStaffName,
    });

    this.logger.log(
      `商家拒绝团购券订单完成: orderNo=${orderNo}, rejectedBy=${rejectedByStaffName}`,
    );
    // 广播退款事件：store 房间（商家端列表刷新）+ voucher-order 房间与 native 订阅者（purelyClub 详情自动变已退款）
    this.realtimeService.publishVoucherOrderStatusChanged({
      storeId,
      orderNo: result.orderNo,
      voucherCode: result.voucherCode,
      status: 'refunded',
      refundAt: result.refundAt,
      rejectedAt: result.rejectedAt,
      rejectedByStaffName,
    });

    return {
      orderNo: result.orderNo,
      status: 'refunded',
      refundAt: result.refundAt,
      rejectedAt: result.rejectedAt,
    };
  }

  /** 解析当前操作员姓名快照（参考空间会话 openOperatorNameSnapshot 模式） */
  private async resolveOperatorNameSnapshot(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<string | null> {
    const staffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );
    if (staffId == null) return null;
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { name: true },
    });
    return staff?.name ?? null;
  }

  private assertPendingStatus(status: string, action: '确认' | '拒绝'): void {
    if (
      !CONFIRMABLE_STATUS.includes(
        status as (typeof CONFIRMABLE_STATUS)[number],
      )
    ) {
      throw new BadRequestException(`该订单当前状态不可${action}`);
    }
  }

  /** 时间筛选：date（YYYY-MM-DD）优先，其次 preset（today/7d/30d，默认 today） */
  private buildTimeRange(query: QueryVoucherOrdersDto): {
    gte: Date;
    lte: Date;
  } | null {
    if (query.date) {
      const [yearText, monthText, dayText] = query.date.split('-');
      const startAt = new Date(
        makeShanghaiMs(
          Number(yearText),
          Number(monthText) - 1,
          Number(dayText),
        ),
      );
      if (Number.isNaN(startAt.getTime())) {
        throw new BadRequestException('日期格式不正确');
      }
      return {
        gte: startAt,
        lte: new Date(
          makeShanghaiMs(
            Number(yearText),
            Number(monthText) - 1,
            Number(dayText),
            23,
            59,
            59,
            999,
          ),
        ),
      };
    }

    const now = new Date();
    const endAt = new Date(
      getShanghaiDayStartMs(now.getTime()) + 86_400_000 - 1,
    );
    const startAt = new Date(getShanghaiDayStartMs(now.getTime()));
    const preset = query.preset ?? VoucherOrderTimePreset.TODAY;
    if (preset === VoucherOrderTimePreset.DAYS_7) {
      return {
        gte: new Date(addShanghaiDays(startAt.getTime(), -6)),
        lte: endAt,
      };
    }
    if (preset === VoucherOrderTimePreset.DAYS_30) {
      return {
        gte: new Date(addShanghaiDays(startAt.getTime(), -29)),
        lte: endAt,
      };
    }
    return { gte: startAt, lte: endAt };
  }

  /** 订单实体 → 列表项（时间为 ISO 字符串，金额保持分单位） */
  private toListItem(row: {
    orderNo: string;
    voucherCode: string | null;
    guestName: string | null;
    guestPhone: string | null;
    categoryName: string | null;
    productName: string;
    quantity: number;
    paidAmountFen: number;
    status: string;
    usedSessionId: number | null;
    createdAt: Date;
    confirmedAt: Date | null;
    verifyAt: Date | null;
    confirmedByStaffName: string | null;
    rejectedAt: Date | null;
    refundAt: Date | null;
    rejectedByStaffName: string | null;
    product: { image: string | null };
  }): VoucherOrderListItemDto {
    return {
      orderNo: row.orderNo,
      voucherCode: row.voucherCode,
      guestName: row.guestName,
      guestPhone: row.guestPhone,
      categoryName: row.categoryName,
      productName: row.productName,
      productImage: row.product.image,
      quantity: row.quantity,
      paidAmountFen: row.paidAmountFen,
      status: row.status as VoucherOrderListItemDto['status'],
      usedSessionId: row.usedSessionId,
      createdAt: row.createdAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      verifyAt: row.verifyAt?.toISOString() ?? null,
      confirmedByStaffName: row.confirmedByStaffName,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      refundAt: row.refundAt?.toISOString() ?? null,
      rejectedByStaffName: row.rejectedByStaffName,
    };
  }
}
