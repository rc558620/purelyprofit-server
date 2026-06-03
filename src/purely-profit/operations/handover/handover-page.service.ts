import { Injectable } from '@nestjs/common';
import {
  EmployeeShiftType,
  FinanceCashFlowCategory,
  FinanceCashFlowDirection,
  FinanceCashFlowPayment,
  HandoverStatus,
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
  CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE,
  ORDER_ITEMS_LIMIT,
  PAYMENT_METHOD_CONFIG,
  ReceiverCandidate,
  SHIFT_TIME_FALLBACKS,
  ShiftRecordRow,
  buildCurrentDayRange,
  buildShiftDateRange,
  ensureMembershipContext,
  isCashierMembership,
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
    const isCashier = isCashierMembership(membership);
    // 收银员必须关联了员工才能查询本人班次；若 linkedEmployeeId 为空，则视为无班次
    const cashierEmployeeId = isCashier ? membership.linkedEmployeeId : null;
    const canQueryShift = !isCashier || cashierEmployeeId !== null;

    // 精确查询：收银员只查自己的班次（有 employeeId），且不允许 fallback
    const requestedShiftRecord = canQueryShift
      ? query.shiftType
        ? await this.findShiftRecord(
            membership.storeId,
            isCashier ? cashierEmployeeId : membership.linkedEmployeeId,
            query.shiftType,
            false,
          )
        : await this.findCurrentShiftRecord(
            membership.storeId,
            isCashier ? cashierEmployeeId : membership.linkedEmployeeId,
          )
      : null;

    const requestedShiftCompleted = query.shiftType
      ? await this.isShiftHandedOver(membership.storeId, requestedShiftRecord)
      : false;
    const shiftOwnerEmployeeId = isCashier
      ? cashierEmployeeId
      : membership.linkedEmployeeId;
    const exactShiftRecord =
      requestedShiftCompleted && shiftOwnerEmployeeId !== null && canQueryShift
        ? await this.findCurrentShiftRecord(
            membership.storeId,
            shiftOwnerEmployeeId,
          )
        : requestedShiftRecord;

    // 验证收银员的精确班次必须属于自己（防止 linkedEmployeeId 为 null 时查到他人班次）
    const ownedExactShiftRecord =
      isCashier && cashierEmployeeId !== null
        ? exactShiftRecord?.employeeId === cashierEmployeeId
          ? exactShiftRecord
          : null
        : exactShiftRecord;

    // scopedShiftRecord：收银员不允许任何 fallback，只使用精确匹配结果
    const scopedShiftRecord = isCashier
      ? ownedExactShiftRecord
      : ownedExactShiftRecord ??
        (query.shiftType
          ? await this.findShiftRecord(
              membership.storeId,
              membership.linkedEmployeeId,
              query.shiftType,
            )
          : ownedExactShiftRecord);

    const allowStoreWideFallback = !isCashier;
    // 收银员仅允许操作自己的班次；主账号/管理身份仍可回退到门店当前班次以兼容原页面读取逻辑。
    const shiftRecord =
      scopedShiftRecord ??
      (allowStoreWideFallback
        ? query.shiftType
          ? await this.findShiftRecord(
              membership.storeId,
              null,
              query.shiftType,
            )
          : await this.findCurrentShiftRecord(membership.storeId, null)
        : null);
    const shiftType =
      scopedShiftRecord?.shiftType ??
      shiftRecord?.shiftType ??
      query.shiftType ??
      EmployeeShiftType.morning;
    const fallbackTime = SHIFT_TIME_FALLBACKS[shiftType];
    const selectedOwnedShiftCompleted = await this.isShiftHandedOver(
      membership.storeId,
      ownedExactShiftRecord,
    );
    const operationAccess = this.resolveOperationAccess(
      membership,
      ownedExactShiftRecord,
      selectedOwnedShiftCompleted,
      query.shiftType,
    );
    // 优先从排班记录取员工姓名；若无排班记录，则查 employees 表获取关联员工的真实姓名，
    // 避免错误地使用登录用户名（user.name / query.operatorName）作为交班人姓名。
    const shiftEmployeeName =
      scopedShiftRecord?.employeeName ?? shiftRecord?.employeeName ?? null;
    const operatorName =
      shiftEmployeeName ??
      (await this.resolveEmployeeDisplayName(membership.linkedEmployeeId)) ??
      toDisplayName(user.name) ??
      '当前员工';

    const shiftInfo = this.buildShiftInfo({
      shiftType,
      startTime:
        scopedShiftRecord?.startTime ??
        shiftRecord?.startTime ??
        fallbackTime.startTime,
      endTime:
        scopedShiftRecord?.endTime ??
        shiftRecord?.endTime ??
        fallbackTime.endTime,
      operatorName,
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
      canOperate: operationAccess.canOperate,
      operationBlockedReason: operationAccess.blockedReason,
    };
  }

  /** 当前端指定班次时：优先匹配员工本人；若传入 employeeId 为空，则按门店范围匹配指定班次 */
  private async findShiftRecord(
    storeId: number,
    employeeId: number | null,
    shiftType: EmployeeShiftType,
    allowEmployeeFallback = true,
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
        employeeId: true,
        employeeName: true,
        shiftType: true,
        startTime: true,
        endTime: true,
      },
      orderBy: employeeId
        ? [{ date: 'desc' }, { id: 'desc' }]
        : [{ startTime: 'asc' }, { id: 'asc' }],
    });
    if (scopedShift || employeeId === null || !allowEmployeeFallback) {
      return scopedShift;
    }

    return this.prisma.employeeShift.findFirst({
      where: {
        storeId,
        employeeId,
        date: todayRange,
      },
      select: {
        employeeId: true,
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
        employeeId: true,
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

    const shiftsWithCompletion = await Promise.all(
      allShifts.map(async (shift) => ({
        shift,
        handedOver: await this.isShiftHandedOver(storeId, shift),
      })),
    );

    const now = new Date();
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
    const activeShiftIndex = shiftsWithCompletion.findIndex(({ shift }) => {
      const startMinutes = this.timeStringToMinutes(shift.startTime);
      const endMinutes = this.timeStringToMinutes(shift.endTime);
      return (
        startMinutes <= currentTimeMinutes && currentTimeMinutes < endMinutes
      );
    });

    if (activeShiftIndex >= 0) {
      const activeShift = shiftsWithCompletion[activeShiftIndex];
      if (!activeShift.handedOver) {
        return activeShift.shift;
      }
      const nextUnhandedShift = shiftsWithCompletion
        .slice(activeShiftIndex + 1)
        .find(({ handedOver }) => !handedOver);
      if (nextUnhandedShift) {
        return nextUnhandedShift.shift;
      }
    }

    const upcomingUnhandedShift = shiftsWithCompletion.find(
      ({ shift, handedOver }) =>
        !handedOver && this.timeStringToMinutes(shift.startTime) > currentTimeMinutes,
    );
    if (upcomingUnhandedShift) {
      return upcomingUnhandedShift.shift;
    }

    let nearestStartedUnhandedShift: ShiftRecordRow | null = null;
    let nearestStartedDiff = Number.POSITIVE_INFINITY;

    for (const { shift, handedOver } of shiftsWithCompletion) {
      if (handedOver) {
        continue;
      }
      const startMinutes = this.timeStringToMinutes(shift.startTime);
      if (startMinutes > currentTimeMinutes) {
        continue;
      }

      const diff = currentTimeMinutes - startMinutes;
      if (diff < nearestStartedDiff) {
        nearestStartedUnhandedShift = shift;
        nearestStartedDiff = diff;
      }
    }

    return (
      nearestStartedUnhandedShift ??
      shiftsWithCompletion.find(({ handedOver }) => !handedOver)?.shift ??
      allShifts[0]
    );
  }

  private resolveOperationAccess(
    membership: NonNullable<AuthenticatedUser['currentMembership']>,
    ownedShiftRecord: ShiftRecordRow | null,
    ownedShiftCompleted: boolean,
    requestedShiftType?: EmployeeShiftType,
  ): { canOperate: boolean; blockedReason: string | null } {
    if (!isCashierMembership(membership)) {
      return {
        canOperate: true,
        blockedReason: null,
      };
    }

    // 收银员没有关联员工时，无法匹配到本人班次，禁止操作
    if (!membership.linkedEmployeeId) {
      return {
        canOperate: false,
        blockedReason: '当前收银员账号未关联员工，暂不允许操作',
      };
    }

    if (ownedShiftCompleted) {
      return {
        canOperate: false,
        blockedReason: '当前班次已完成交班，暂不允许重复操作',
      };
    }

    // ownedShiftRecord 已经过 employeeId 验证，确保属于本人
    if (
      ownedShiftRecord &&
      ownedShiftRecord.employeeId === membership.linkedEmployeeId
    ) {
      return {
        canOperate: true,
        blockedReason: null,
      };
    }

    return {
      canOperate: false,
      blockedReason: requestedShiftType
        ? CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE
        : '当前时段没有该收银员本人班次，暂不允许操作',
    };
  }

  private async isShiftHandedOver(
    storeId: number,
    shiftRecord: ShiftRecordRow | null,
  ): Promise<boolean> {
    if (!shiftRecord?.employeeId) {
      return false;
    }

    const shiftRange = buildShiftDateRange(
      shiftRecord.startTime,
      shiftRecord.endTime,
    );
    const count = await this.prisma.storeHandoverRecord.count({
      where: {
        storeId,
        fromEmployeeId: shiftRecord.employeeId,
        status: HandoverStatus.completed,
        handoverAt: {
          gte: shiftRange.startAt,
          lte: shiftRange.endAt,
        },
      },
    });
    return count > 0;
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

  /** 当无排班记录时，通过 linkedEmployeeId 直接查 employees 表获取员工真实姓名 */
  private async resolveEmployeeDisplayName(
    employeeId: number | null,
  ): Promise<string | null> {
    if (!employeeId) {
      return null;
    }
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { name: true },
    });
    return toDisplayName(employee?.name);
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
