import { Injectable } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';
import {
  HandoverPageShiftRecordService,
  type NextShiftLookupMemo,
} from './handover-page-shift-record.service';
import {
  HandoverShiftHandoverStatusService,
  type ShiftHandoverStatusMemo,
} from './handover-shift-handover-status.service';
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import {
  isCashierMembership,
  type MembershipContext,
  type OwnedShiftSelection,
  type ResolvedPageShiftSelection,
  type ShiftRecordRow,
} from './handover.shared';

/**
 * 班次选择过程的请求级上下文。
 *
 * 把「门店 / 请求班次 / 展示目标 / 交班状态 memo」打包成单个对象：
 * 一是让 memo 沿调用链一路透传（同一 shift 只 count 一次），
 * 二是避免私有方法参数继续膨胀（质量门要求参数 ≤ 4）。
 */
type ShiftSelectionContext = {
  membership: MembershipContext;
  requestedShiftType?: EmployeeShiftType;
  displayTargetEmployeeId: number | null;
  handoverStatusMemo: ShiftHandoverStatusMemo;
  /** 请求级「后续班次」缓存：与页面上下文共用，同 (班次, 员工范围) 只查一次 */
  nextShiftMemo: NextShiftLookupMemo;
  /**
   * 请求级「当前班次」缓存，key = 门店 + 员工范围 + 上海业务日。
   *
   * 班次选择内部会针对同一 (员工范围, 业务日) 反复问「当前班次」：
   * 主账号/老板没有绑定员工（employeeId = null）时，
   * 「自己的当前班次」与「全店当前班次」是同一个查询；
   * 另外 requestedShiftType 全交班后的 exactShiftRecord 兜底会再问一次同名查询。
   * 不缓存每次都要拉一遍全店排班 + 交班记录（老店可达数千行）。
   *
   * 只在单次 resolveShiftSelection 内有效：排班随时可能被改写。
   */
  currentShiftMemo: Map<string, Promise<ShiftRecordRow | null>>;
};

@Injectable()
export class HandoverPageShiftSelectorService {
  constructor(
    private readonly handoverPageShiftRecordService: HandoverPageShiftRecordService,
    private readonly handoverShiftHandoverStatusService: HandoverShiftHandoverStatusService,
  ) {}

  async resolveShiftSelection(params: {
    membership: MembershipContext;
    requestedShiftType?: EmployeeShiftType;
    displayTargetEmployeeId: number | null;
    /** 请求级交班状态缓存：与页面上下文共用同一份，避免同 shift 重复 count */
    handoverStatusMemo?: ShiftHandoverStatusMemo;
    /** 请求级后续班次缓存：与页面上下文共用同一份，避免同班次重复查后续班次 */
    nextShiftMemo?: NextShiftLookupMemo;
  }): Promise<ResolvedPageShiftSelection> {
    const context: ShiftSelectionContext = {
      membership: params.membership,
      requestedShiftType: params.requestedShiftType,
      displayTargetEmployeeId: params.displayTargetEmployeeId,
      handoverStatusMemo: params.handoverStatusMemo ?? new Map(),
      nextShiftMemo: params.nextShiftMemo ?? new Map(),
      currentShiftMemo: new Map(),
    };
    const ownedSelection = await this.resolveOwnedShiftSelection(context);
    const scopedShiftRecord = await this.resolveScopedShiftRecord(
      context,
      ownedSelection,
    );
    const shiftRecord = await this.resolveSelectedShiftRecord(
      context,
      scopedShiftRecord,
    );

    return {
      ownedSelection,
      shiftRecord,
      operationShiftRecord: this.resolveOperationShiftRecord(
        shiftRecord,
        ownedSelection,
      ),
    };
  }

  private async resolveOwnedShiftSelection(
    context: ShiftSelectionContext,
  ): Promise<OwnedShiftSelection> {
    const { membership, requestedShiftType, handoverStatusMemo } = context;
    const isCashier = isCashierMembership(membership);
    const cashierEmployeeId = isCashier ? membership.linkedEmployeeId : null;
    if (isCashier && cashierEmployeeId === null) {
      return { isCashier, cashierEmployeeId, ownedExactShiftRecord: null };
    }

    const shiftOwnerEmployeeId = isCashier
      ? cashierEmployeeId
      : membership.linkedEmployeeId;
    const requestedShiftRecord = await this.findRequestedShiftRecord(
      context,
      shiftOwnerEmployeeId,
      requestedShiftType,
    );
    const requestedShiftCompleted = requestedShiftType
      ? await this.handoverShiftHandoverStatusService.isShiftHandedOver(
          membership.storeId,
          requestedShiftRecord,
          handoverStatusMemo,
        )
      : false;
    const exactShiftRecord =
      requestedShiftCompleted && shiftOwnerEmployeeId !== null
        ? await this.findCurrentShiftRecordCached(context, shiftOwnerEmployeeId)
        : requestedShiftRecord;

    return {
      isCashier,
      cashierEmployeeId,
      ownedExactShiftRecord: this.filterCashierOwnedShift(
        exactShiftRecord,
        isCashier,
        cashierEmployeeId,
      ),
    };
  }

  private async findRequestedShiftRecord(
    context: ShiftSelectionContext,
    employeeId: number | null,
    requestedShiftType?: EmployeeShiftType,
  ): Promise<ShiftRecordRow | null> {
    if (requestedShiftType) {
      return this.handoverPageShiftRecordService.findShiftRecord(
        context.membership.storeId,
        employeeId,
        requestedShiftType,
        false,
      );
    }

    return this.findCurrentShiftRecordCached(context, employeeId);
  }

  /**
   * 「当前班次」查询的请求级复用。
   *
   * key 带上海业务日：loadShifts 的日期上界是 endOfDay(referenceDate)，
   * 同一业务日内结果一致；跨日的两次调用各查一次即可，不做跨日复用。
   */
  private findCurrentShiftRecordCached(
    context: ShiftSelectionContext,
    employeeId: number | null,
  ): Promise<ShiftRecordRow | null> {
    const { storeId } = context.membership;
    const memoKey = `${storeId}:${employeeId ?? 'all'}:${getShanghaiDayStartMs(Date.now())}`;
    const cached = context.currentShiftMemo.get(memoKey);
    if (cached) {
      return cached;
    }

    const pending = this.handoverPageShiftRecordService.findCurrentShiftRecord(
      storeId,
      employeeId,
    );
    context.currentShiftMemo.set(memoKey, pending);

    return pending;
  }

  private filterCashierOwnedShift(
    shiftRecord: ShiftRecordRow | null,
    isCashier: boolean,
    cashierEmployeeId: number | null,
  ): ShiftRecordRow | null {
    if (!isCashier || cashierEmployeeId === null) {
      return shiftRecord;
    }

    return shiftRecord?.employeeId === cashierEmployeeId ? shiftRecord : null;
  }

  private async resolveScopedShiftRecord(
    context: ShiftSelectionContext,
    ownedSelection: OwnedShiftSelection,
  ): Promise<ShiftRecordRow | null> {
    const { membership, requestedShiftType } = context;
    if (ownedSelection.isCashier || !requestedShiftType) {
      return ownedSelection.ownedExactShiftRecord;
    }
    if (ownedSelection.ownedExactShiftRecord) {
      return ownedSelection.ownedExactShiftRecord;
    }

    return this.handoverPageShiftRecordService.findShiftRecord(
      membership.storeId,
      membership.linkedEmployeeId,
      requestedShiftType,
    );
  }

  private async resolveSelectedShiftRecord(
    context: ShiftSelectionContext,
    scopedShiftRecord: ShiftRecordRow | null,
  ): Promise<ShiftRecordRow | null> {
    const { membership, requestedShiftType, displayTargetEmployeeId } = context;
    if (displayTargetEmployeeId !== null) {
      const targetShiftRecord = await this.resolveDisplayTargetShiftRecord(
        context,
        displayTargetEmployeeId,
      );
      if (targetShiftRecord) {
        return targetShiftRecord;
      }
    }

    const storeWideCurrentShiftRecord = await this.findCurrentShiftRecordCached(
      context,
      null,
    );
    if (storeWideCurrentShiftRecord) {
      return storeWideCurrentShiftRecord;
    }

    const storeWideRequestedShiftRecord = requestedShiftType
      ? await this.handoverPageShiftRecordService.findShiftRecord(
          membership.storeId,
          null,
          requestedShiftType,
        )
      : null;

    return storeWideRequestedShiftRecord ?? scopedShiftRecord;
  }

  private async resolveDisplayTargetShiftRecord(
    context: ShiftSelectionContext,
    displayTargetEmployeeId: number,
  ): Promise<ShiftRecordRow | null> {
    const {
      membership,
      requestedShiftType,
      handoverStatusMemo,
      nextShiftMemo,
    } = context;
    const storeId = membership.storeId;
    const targetShiftRecord = requestedShiftType
      ? await this.handoverPageShiftRecordService.findShiftRecord(
          storeId,
          displayTargetEmployeeId,
          requestedShiftType,
          false,
        )
      : await this.findCurrentShiftRecordCached(
          context,
          displayTargetEmployeeId,
        );
    if (!targetShiftRecord) {
      return null;
    }

    if (!requestedShiftType) {
      return targetShiftRecord;
    }

    const targetShiftCompleted =
      await this.handoverShiftHandoverStatusService.isShiftHandedOver(
        storeId,
        targetShiftRecord,
        handoverStatusMemo,
      );
    if (!targetShiftCompleted) {
      return targetShiftRecord;
    }

    return (
      (await this.handoverPageShiftRecordService.findNextShiftRecord(
        storeId,
        targetShiftRecord,
        undefined,
        nextShiftMemo,
      )) ?? null
    );
  }

  private resolveOperationShiftRecord(
    shiftRecord: ShiftRecordRow | null,
    ownedSelection: OwnedShiftSelection,
  ): ShiftRecordRow | null {
    if (ownedSelection.isCashier) {
      return shiftRecord?.employeeId === ownedSelection.cashierEmployeeId
        ? shiftRecord
        : null;
    }

    return shiftRecord ?? ownedSelection.ownedExactShiftRecord;
  }
}
