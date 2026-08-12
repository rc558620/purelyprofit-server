// 团购券订单核销服务：用户端立即核销（pending → used，仅记录 verifyAt，未绑定开台会话）
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
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
      },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
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
      throw new BadRequestException(CLUB_VOUCHER_VERIFY_NOT_ALLOWED_MESSAGE);
    }

    const now = new Date();
    const updated = await this.prisma.clubVoucherOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'used', verifyAt: now },
    });
    if (updated.count !== 1) {
      throw new BadRequestException(CLUB_VOUCHER_VERIFY_NOT_ALLOWED_MESSAGE);
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

  private formatDateTime(date: Date): string {
    const shanghai = new Date(date.getTime() + 8 * 60 * 60_000);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return [
      shanghai.getUTCFullYear(),
      '-',
      pad(shanghai.getUTCMonth() + 1),
      '-',
      pad(shanghai.getUTCDate()),
      ' ',
      pad(shanghai.getUTCHours()),
      ':',
      pad(shanghai.getUTCMinutes()),
    ].join('');
  }
}
