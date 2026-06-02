import { Injectable } from '@nestjs/common';
import {
  EmployeeShiftType,
  FinanceCashFlowCategory,
  FinanceCashFlowDirection,
  FinanceCashFlowPayment,
  Prisma,
  SalesPaymentMethod,
  SpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import type {
  HandoverPageQueryDto,
  HandoverPageResponseDto,
  HandoverPaymentItemDto,
  HandoverShiftInfoDto,
} from './dto/handover.dto';
import {
  ORDER_ITEMS_LIMIT,
  PAYMENT_METHOD_CONFIG,
  ReceiverCandidate,
  SHIFT_TIME_FALLBACKS,
  ShiftRecordRow,
  buildCurrentDayRange,
  buildShiftDateRange,
  ensureMembershipContext,
  mapOrderItem,
  roundMoney,
  toDisplayName,
  toMoneyNumber,
} from './handover.shared';

@Injectable()
export class HandoverPageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSubAccountService: StoreSubAccountService,
  ) {}

  async getHandoverPage(
    user: AuthenticatedUser,
    query: HandoverPageQueryDto,
  ): Promise<HandoverPageResponseDto> {
    const membership = ensureMembershipContext(user);
    // 优先按当前登录人绑定的员工档案命中排班；若主账号未绑定员工或未排班，再回退到门店今日排班。
    const scopedShiftRecord = query.shiftType
      ? await this.findShiftRecord(
          membership.storeId,
          membership.linkedEmployeeId,
          query.shiftType,
        )
      : await this.findCurrentShiftRecord(
          membership.storeId,
          membership.linkedEmployeeId,
        );
    const shiftRecord =
      scopedShiftRecord ??
      (query.shiftType
        ? await this.findShiftRecord(membership.storeId, null, query.shiftType)
        : await this.findCurrentShiftRecord(membership.storeId, null));
    const shiftType =
      shiftRecord?.shiftType ?? query.shiftType ?? EmployeeShiftType.morning;
    const fallbackTime = SHIFT_TIME_FALLBACKS[shiftType];
    const shiftInfo = this.buildShiftInfo({
      shiftType,
      startTime: shiftRecord?.startTime ?? fallbackTime.startTime,
      endTime: shiftRecord?.endTime ?? fallbackTime.endTime,
      operatorName:
        shiftRecord?.employeeName ??
        toDisplayName(query.operatorName) ??
        toDisplayName(user.name) ??
        '当前员工',
    });
    const shiftRange = buildShiftDateRange(
      shiftInfo.startTime,
      shiftInfo.endTime,
    );
    const orderWhere = this.buildSaleOrderWhere(
      membership.storeId,
      shiftRange,
      membership.staffId,
    );
    const cashFlowWhere = this.buildCashFlowWhere(
      membership.storeId,
      shiftRange,
      membership.staffId,
    );
    const receiverCandidate = await this.findReceiverCandidate(
      membership.storeId,
      membership.linkedEmployeeId,
    );

    const [
      paymentGroups,
      orderItems,
      orderCount,
      spaceRevenue,
      additionalRevenue,
      pettyCash,
    ] = await Promise.all([
      this.prisma.saleOrder.groupBy({
        by: ['paymentMethod'],
        where: orderWhere,
        _sum: { totalRevenue: true },
        orderBy: { paymentMethod: 'asc' },
      }),
      this.prisma.saleOrderItem.findMany({
        where: {
          storeId: membership.storeId,
          order: orderWhere,
        },
        select: {
          id: true,
          productName: true,
          salePrice: true,
          quantity: true,
          product: {
            select: {
              stock: true,
              unit: true,
            },
          },
          order: {
            select: {
              date: true,
              paymentMethod: true,
              spaceSession: {
                select: {
                  prepaidPaymentMethod: true,
                  renewRecords: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ORDER_ITEMS_LIMIT,
      }),
      this.prisma.saleOrder.count({ where: orderWhere }),
      this.prisma.spaceSession.aggregate({
        where: {
          storeId: membership.storeId,
          status: SpaceSessionStatus.settled,
          endTime: {
            gte: shiftRange.startAt,
            lte: shiftRange.endAt,
          },
        },
        _sum: { timeCost: true },
      }),
      this.prisma.saleOrder.aggregate({
        where: {
          ...orderWhere,
          spaceSession: {
            is: null,
          },
        },
        _sum: { totalRevenue: true },
      }),
      this.prisma.financeCashFlowRecord.aggregate({
        where: {
          ...cashFlowWhere,
          direction: FinanceCashFlowDirection.income,
          category: FinanceCashFlowCategory.transfer_in,
          payment: FinanceCashFlowPayment.cash,
        },
        _sum: { amount: true },
      }),
    ]);

    const paymentItems = this.mapPaymentItems(paymentGroups);
    const totalRevenue = this.sumPaymentAmounts(paymentItems);

    return {
      selectedShiftType: shiftInfo.shiftType,
      shiftInfo,
      revenueSummary: {
        additionalRevenue: toMoneyNumber(additionalRevenue._sum.totalRevenue),
        spaceRevenue: toMoneyNumber(spaceRevenue._sum.timeCost),
        totalRevenue,
        orderCount,
        pettyCache: toMoneyNumber(pettyCash._sum.amount),
      },
      paymentItems: this.attachPaymentRatios(paymentItems, totalRevenue),
      orderItems: orderItems.map((item) => mapOrderItem(item)),
      receiverName: receiverCandidate?.employeeName ?? '',
    };
  }

  /** 当前端指定班次时：优先匹配员工本人；若传入 employeeId 为空，则按门店范围匹配指定班次 */
  private async findShiftRecord(
    storeId: number,
    employeeId: number | null,
    shiftType: EmployeeShiftType,
  ): Promise<ShiftRecordRow | null> {
    const todayRange = buildCurrentDayRange();
    const scopedShift = await this.prisma.employeeShift.findFirst({
      where: {
        storeId,
        ...(employeeId ? { employeeId } : {}),
        shiftType,
        date: todayRange,
      },
      select: {
        employeeName: true,
        shiftType: true,
        startTime: true,
        endTime: true,
      },
      orderBy: employeeId
        ? [{ date: 'desc' }, { id: 'desc' }]
        : [{ startTime: 'asc' }, { id: 'asc' }],
    });
    if (scopedShift || employeeId === null) {
      return scopedShift;
    }

    return this.prisma.employeeShift.findFirst({
      where: {
        storeId,
        employeeId,
        date: todayRange,
      },
      select: {
        employeeName: true,
        shiftType: true,
        startTime: true,
        endTime: true,
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });
  }

  /** 当前端未指定班次时：根据当前时间智能匹配最合适的班次 */
  private async findCurrentShiftRecord(
    storeId: number,
    employeeId: number | null,
  ): Promise<ShiftRecordRow | null> {
    const todayRange = buildCurrentDayRange();
    const allShifts = await this.prisma.employeeShift.findMany({
      where: {
        storeId,
        ...(employeeId ? { employeeId } : {}),
        date: todayRange,
      },
      select: {
        employeeName: true,
        shiftType: true,
        startTime: true,
        endTime: true,
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });

    if (allShifts.length === 0) {
      return null;
    }

    // 若只有一条班次，直接返回
    if (allShifts.length === 1) {
      return allShifts[0];
    }

    // 根据当前时间匹配最适的班次
    const now = new Date();
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

    // 优先查找"当前时间在班次时间范围内"的班次
    for (const shift of allShifts) {
      const startMinutes = this.timeStringToMinutes(shift.startTime);
      const endMinutes = this.timeStringToMinutes(shift.endTime);

      if (
        startMinutes <= currentTimeMinutes &&
        currentTimeMinutes < endMinutes
      ) {
        return shift;
      }
    }

    // 若当前时间不在任何班次范围内，优先返回“最近一个已开始的班次”；
    // 若今天的班次都还未开始，则返回当天最早的班次。
    let nearestStartedShift: ShiftRecordRow | null = null;
    let nearestStartedDiff = Number.POSITIVE_INFINITY;

    for (const shift of allShifts) {
      const startMinutes = this.timeStringToMinutes(shift.startTime);
      if (startMinutes > currentTimeMinutes) {
        continue;
      }

      const diff = currentTimeMinutes - startMinutes;
      if (diff < nearestStartedDiff) {
        nearestStartedShift = shift;
        nearestStartedDiff = diff;
      }
    }

    return nearestStartedShift ?? allShifts[0];
  }

  /** 将 "HH:mm" 转换为分钟数 */
  private timeStringToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map((v) => parseInt(v, 10));
    return hours * 60 + (minutes || 0);
  }

  private buildShiftInfo(params: {
    shiftType: EmployeeShiftType;
    startTime: string;
    endTime: string;
    operatorName: string;
  }): HandoverShiftInfoDto {
    return {
      shiftType: params.shiftType,
      startTime: params.startTime,
      endTime: params.endTime,
      operatorName: params.operatorName,
      handedOverAt: Date.now(),
    };
  }

  private buildSaleOrderWhere(
    storeId: number,
    shiftRange: { startAt: Date; endAt: Date },
    operatorStaffId: number | null,
  ): Prisma.SaleOrderWhereInput {
    return {
      storeId,
      date: {
        gte: shiftRange.startAt,
        lte: shiftRange.endAt,
      },
      ...(operatorStaffId ? { operatorStaffId } : {}),
    };
  }

  private buildCashFlowWhere(
    storeId: number,
    shiftRange: { startAt: Date; endAt: Date },
    operatorStaffId: number | null,
  ): Prisma.FinanceCashFlowRecordWhereInput {
    return {
      storeId,
      date: {
        gte: shiftRange.startAt,
        lte: shiftRange.endAt,
      },
      ...(operatorStaffId ? { operatorStaffId } : {}),
    };
  }

  private mapPaymentItems(
    rows: Array<{
      paymentMethod: SalesPaymentMethod;
      _sum: { totalRevenue: Prisma.Decimal | null };
    }>,
  ): HandoverPaymentItemDto[] {
    return rows.map((row) => ({
      method: row.paymentMethod,
      label: PAYMENT_METHOD_CONFIG[row.paymentMethod].label,
      amount: toMoneyNumber(row._sum.totalRevenue),
      ratio: 0,
      color: PAYMENT_METHOD_CONFIG[row.paymentMethod].color,
    }));
  }

  private attachPaymentRatios(
    items: HandoverPaymentItemDto[],
    totalRevenue: number,
  ): HandoverPaymentItemDto[] {
    return items.map((item) => ({
      ...item,
      ratio: totalRevenue > 0 ? roundMoney(item.amount / totalRevenue) : 0,
    }));
  }

  private sumPaymentAmounts(items: HandoverPaymentItemDto[]): number {
    return roundMoney(items.reduce((sum, item) => sum + item.amount, 0));
  }

  private async findReceiverCandidate(
    storeId: number,
    currentEmployeeId: number | null,
  ): Promise<ReceiverCandidate | null> {
    const candidates =
      await this.storeSubAccountService.listAssignableHandoverCandidates(
        storeId,
      );
    const matched = candidates.find(
      (candidate) => candidate.employeeId !== currentEmployeeId,
    );
    return matched
      ? {
          employeeId: matched.employeeId,
          employeeName: matched.employeeName,
          subAccountId: matched.subAccountId,
        }
      : null;
  }
}
