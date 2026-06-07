import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateSalesRecordDto,
  SalesRecordResponseDto,
} from '../sales-record/dto/sales-record.dto';
import { SalesRecordService } from '../sales-record/sales-record.service';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';
import {
  toSpaceSessionItemsJson,
  toSpaceSessionRenewRecordsJson,
} from './space-sessions.mapper';
import type {
  SpaceSessionItemRecord,
  SpaceSessionRecord,
  SpaceSessionRenewRecord,
  SpaceSessionSettlement,
  SpaceSessionSettlementRecord,
} from './space-sessions.types';

export interface SettleSpaceSessionParams {
  session: SpaceSessionSettlementRecord;
  checkoutAt: number;
  paymentMethod: SalesPaymentMethodValue;
  note?: string;
  settlement: SpaceSessionSettlement;
  renewRecords: SpaceSessionRenewRecord[];
}

export interface SettleSpaceSessionResult {
  session: SpaceSessionRecord;
  spaceStatus: PrismaSpaceStatus;
  cancelledReservationId: number | null;
  salesOrder: SalesRecordResponseDto;
}

@Injectable()
export class SpaceSessionSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesRecordService: SalesRecordService,
  ) {}

  async settleSession(
    user: AuthenticatedUser,
    params: SettleSpaceSessionParams,
  ): Promise<SettleSpaceSessionResult> {
    const latestSession = await this.prisma.spaceSession.findUnique({
      where: { id: params.session.id },
      select: { status: true },
    });

    if (!latestSession) {
      throw new NotFoundException('空间会话不存在');
    }

    if (latestSession.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法重复操作');
    }

    const createdOrder = await this.createSessionSaleOrder(user, {
      storeId: params.session.storeId,
      checkoutAt: params.checkoutAt,
      paymentMethod: params.paymentMethod,
      note: params.note,
      items: params.settlement.orderItems,
      totalRevenue: params.settlement.totalRevenue,
      totalProfit: params.settlement.totalProfit,
      totalQuantity: params.settlement.totalQuantity,
    });

    const updated = await this.prisma.$transaction(async (transaction) => {
      const nextSession = await transaction.spaceSession.update({
        where: { id: params.session.id },
        data: {
          endTime: new Date(params.checkoutAt),
          timeCost: new Prisma.Decimal(params.settlement.timeCost),
          items: toSpaceSessionItemsJson(params.settlement.orderItems),
          itemsCost: new Prisma.Decimal(params.settlement.itemsCost),
          renewRecords: toSpaceSessionRenewRecordsJson(params.renewRecords),
          status: PrismaSpaceSessionStatus.settled,
          saleOrderId: Number(createdOrder.id),
        },
        include: {
          space: {
            select: {
              id: true,
              name: true,
              type: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      const cancelledReservationId =
        await this.cancelMatchedReservationAfterCheckout(
          transaction,
          params.session,
        );
      const nextSpaceStatus = params.session.space.enableDirtyRoom
        ? PrismaSpaceStatus.cleaning
        : await this.resolveReservationBackStatus(
            transaction,
            params.session.spaceId,
          );

      await transaction.space.update({
        where: { id: params.session.spaceId },
        data: {
          status: nextSpaceStatus,
        },
      });

      return {
        session: nextSession,
        spaceStatus: nextSpaceStatus,
        cancelledReservationId,
      };
    });

    return {
      ...updated,
      salesOrder: createdOrder,
    };
  }

  private async createSessionSaleOrder(
    user: AuthenticatedUser,
    params: {
      storeId: number;
      checkoutAt: number;
      paymentMethod: SalesPaymentMethodValue;
      note?: string;
      items: SpaceSessionItemRecord[];
      totalRevenue: number;
      totalProfit: number;
      totalQuantity: number;
    },
  ): Promise<SalesRecordResponseDto> {
    const dto: CreateSalesRecordDto = {
      storeId: params.storeId,
      items: params.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName,
        salePrice: item.salePrice,
        profit: item.profit,
        quantity: item.quantity,
      })),
      totalRevenue: params.totalRevenue,
      totalProfit: params.totalProfit,
      totalQuantity: params.totalQuantity,
      paymentMethod: params.paymentMethod,
      calcMode: 'business',
      ...(params.note ? { note: params.note } : {}),
      date: params.checkoutAt,
    };

    return this.salesRecordService.create(user, dto, {
      // 追加点单时 session.items 已经扣过库存，结账只生成销售单，不再重复校验/扣减。
      skipInventoryValidationAndDeduction: true,
      // 结账权限已在 checkout service 层以 operation-entry:create 完成验证，无需再检查 sales:create。
      skipAccessCheck: true,
      // 主账号/店长代客结账时，应优先归属到当前待交班班次员工，避免逾期未交班后账目落到下一班。
      assignToCurrentShiftOperator: true,
    });
  }

  private async cancelMatchedReservationAfterCheckout(
    transaction: Prisma.TransactionClient,
    session: SpaceSessionSettlementRecord,
  ): Promise<number | null> {
    if (session.reservationId !== null) {
      return null;
    }

    const guestName = session.guestName?.trim();
    const guestPhone = session.guestPhone?.trim();
    if (!guestName || !guestPhone) {
      return null;
    }

    const todayRange = this.getTodayRange();
    const candidates = await transaction.spaceReservation.findMany({
      where: {
        spaceId: session.spaceId,
        status: PrismaSpaceReservationStatus.pending,
        guestName,
        phone: guestPhone,
        reservedAt: {
          gte: todayRange.start,
          lte: todayRange.end,
        },
      },
      orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
    });

    const nearest = candidates.sort(
      (a, b) =>
        Math.abs(a.reservedAt.getTime() - session.startTime.getTime()) -
        Math.abs(b.reservedAt.getTime() - session.startTime.getTime()),
    )[0];

    if (!nearest) {
      return null;
    }

    await transaction.spaceReservation.update({
      where: { id: nearest.id },
      data: {
        status: PrismaSpaceReservationStatus.cancelled,
      },
    });

    return nearest.id;
  }

  private async resolveReservationBackStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
  ): Promise<PrismaSpaceStatus> {
    const todayRange = this.getTodayRange();
    const hasTodayPendingReservation =
      await transaction.spaceReservation.findFirst({
        where: {
          spaceId,
          status: PrismaSpaceReservationStatus.pending,
          reservedAt: {
            gte: todayRange.start,
            lte: todayRange.end,
          },
        },
        select: {
          id: true,
        },
      });

    return hasTodayPendingReservation
      ? PrismaSpaceStatus.reserved
      : PrismaSpaceStatus.idle;
  }

  private getTodayRange(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

    return { start, end };
  }
}
