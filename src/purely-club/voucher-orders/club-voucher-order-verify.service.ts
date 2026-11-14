// 团购券订单核销服务：用户端立即核销（pending → used，仅记录 verifyAt，未绑定开台会话）
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CLUB_VOUCHER_ERROR_CODE,
  clubVoucherError,
} from './club-voucher-orders.errors';
import { PrismaService } from '../../prisma/prisma.service';
import { formatShanghaiDateTime } from '../../shared/shanghai-time.utils';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_VERIFY_EXPIRED_MESSAGE,
  CLUB_VOUCHER_VERIFY_NOT_ALLOWED_MESSAGE,
} from './club-voucher-orders.constants';

/** 核销结果 */
export interface ClubVoucherVerifyResult {
  orderNo: string;
  status: 'used';
  verifyAt: string;
}

@Injectable()
export class ClubVoucherOrderVerifyService {
  private readonly logger = new Logger(ClubVoucherOrderVerifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  /** 用户端立即核销：pending → used（verifyAt），幂等（重复核销直接返回现状） */
  async verifyVoucherOrder(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubVoucherVerifyResult> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo, userId: currentContext.user.id },
      select: {
        id: true,
        orderNo: true,
        storeId: true,
        voucherCode: true,
        status: true,
        verifyAt: true,
        expiresAt: true,
      },
    });
    if (!order) {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
          CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
        ),
      );
    }

    // 已核销（used）幂等返回；开台使用后的 used 也视为已核销
    if (order.status === 'used') {
      return {
        orderNo: order.orderNo,
        status: 'used',
        verifyAt: this.formatDateTime(order.verifyAt ?? new Date()),
      };
    }
    if (order.status !== 'pending') {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.STATUS_VERIFY_NOT_ALLOWED,
          CLUB_VOUCHER_VERIFY_NOT_ALLOWED_MESSAGE,
        ),
      );
    }
    // 过期校验：惰性过期只在列表/详情被读到时才翻转，未翻转的过期券状态仍是 pending，
    // 此处必须按 expiresAt 判定，否则一张过期券可以被成功核销。
    if (order.expiresAt && order.expiresAt < new Date()) {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.RULE_VERIFY_EXPIRED,
          CLUB_VOUCHER_VERIFY_EXPIRED_MESSAGE,
        ),
      );
    }

    const now = new Date();
    const updated = await this.prisma.clubVoucherOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'used', verifyAt: now },
    });
    if (updated.count !== 1) {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.STATUS_VERIFY_NOT_ALLOWED,
          CLUB_VOUCHER_VERIFY_NOT_ALLOWED_MESSAGE,
        ),
      );
    }

    this.logger.log(`团购券用户端核销成功: orderNo=${order.orderNo}`);
    // 核销成功广播：store 房间（商家端查看订单页实时变已消费）+ voucher-order 房间与 native 订阅者（purelyClub 详情页）
    this.realtimeService.publishVoucherOrderStatusChanged({
      storeId: order.storeId,
      orderNo: order.orderNo,
      voucherCode: order.voucherCode ?? '',
      status: 'used',
      usedAt: now.toISOString(),
    });
    return {
      orderNo: order.orderNo,
      status: 'used',
      verifyAt: this.formatDateTime(now),
    };
  }

  /** 上海墙钟 `YYYY-MM-DD HH:mm`，统一走共享工具，避免两处手工 +8h 口径漂移。 */
  private formatDateTime(date: Date): string {
    return formatShanghaiDateTime(date.getTime());
  }
}
