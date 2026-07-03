import { Injectable } from '@nestjs/common';
import { EmployeeShiftType } from '@prisma/client';
import { HandoverPageShiftRecordService } from './handover-page-shift-record.service';
import { HandoverShiftHandoverStatusService } from './handover-shift-handover-status.service';
import {
  isCashierMembership,
  type MembershipContext,
  type OwnedShiftSelection,
  type ResolvedPageShiftSelection,
  type ShiftRecordRow,
} from './handover.shared';

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
  }): Promise<ResolvedPageShiftSelection> {
    const { displayTargetEmployeeId, membership, requestedShiftType } = params;
    const ownedSelection = await this.resolveOwnedShiftSelection(
      membership,
      requestedShiftType,
    );
    const scopedShiftRecord = await this.resolveScopedShiftRecord(
      membership,
      requestedShiftType,
      ownedSelection,
    );
    const shiftRecord = await this.resolveSelectedShiftRecord(
      membership.storeId,
      requestedShiftType,
      scopedShiftRecord,
      displayTargetEmployeeId,
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
    membership: MembershipContext,
    requestedShiftType?: EmployeeShiftType,
  ): Promise<OwnedShiftSelection> {
    const isCashier = isCashierMembership(membership);
    const cashierEmployeeId = isCashier ? membership.linkedEmployeeId : null;
    if (isCashier && cashierEmployeeId === null) {
      return { isCashier, cashierEmployeeId, ownedExactShiftRecord: null };
    }

    const shiftOwnerEmployeeId = isCashier
      ? cashierEmployeeId
      : membership.linkedEmployeeId;
    const requestedShiftRecord = await this.findRequestedShiftRecord(
      membership.storeId,
      shiftOwnerEmployeeId,
      requestedShiftType,
    );
    const requestedShiftCompleted = requestedShiftType
      ? await this.handoverShiftHandoverStatusService.isShiftHandedOver(
          membership.storeId,
          requestedShiftRecord,
        )
      : false;
    const exactShiftRecord =
      requestedShiftCompleted && shiftOwnerEmployeeId !== null
        ? await this.handoverPageShiftRecordService.findCurrentShiftRecord(
            membership.storeId,
            shiftOwnerEmployeeId,
          )
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
    storeId: number,
    employeeId: number | null,
    requestedShiftType?: EmployeeShiftType,
  ): Promise<ShiftRecordRow | null> {
    if (requestedShiftType) {
      return this.handoverPageShiftRecordService.findShiftRecord(
        storeId,
        employeeId,
        requestedShiftType,
        false,
      );
    }

    return this.handoverPageShiftRecordService.findCurrentShiftRecord(
      storeId,
      employeeId,
    );
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
    membership: MembershipContext,
    requestedShiftType: EmployeeShiftType | undefined,
    ownedSelection: OwnedShiftSelection,
  ): Promise<ShiftRecordRow | null> {
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
    storeId: number,
    requestedShiftType: EmployeeShiftType | undefined,
    scopedShiftRecord: ShiftRecordRow | null,
    displayTargetEmployeeId: number | null,
  ): Promise<ShiftRecordRow | null> {
    if (displayTargetEmployeeId !== null) {
      const targetShiftRecord = await this.resolveDisplayTargetShiftRecord(
        storeId,
        displayTargetEmployeeId,
        requestedShiftType,
      );
      if (targetShiftRecord) {
        return targetShiftRecord;
      }
    }

    const storeWideCurrentShiftRecord =
      await this.handoverPageShiftRecordService.findCurrentShiftRecord(
        storeId,
        null,
      );
    if (storeWideCurrentShiftRecord) {
      return storeWideCurrentShiftRecord;
    }

    const storeWideRequestedShiftRecord = requestedShiftType
      ? await this.handoverPageShiftRecordService.findShiftRecord(
          storeId,
          null,
          requestedShiftType,
        )
      : null;

    return storeWideRequestedShiftRecord ?? scopedShiftRecord;
  }

  private async resolveDisplayTargetShiftRecord(
    storeId: number,
    displayTargetEmployeeId: number,
    requestedShiftType?: EmployeeShiftType,
  ): Promise<ShiftRecordRow | null> {
    const targetShiftRecord = requestedShiftType
      ? await this.handoverPageShiftRecordService.findShiftRecord(
          storeId,
          displayTargetEmployeeId,
          requestedShiftType,
          false,
        )
      : await this.handoverPageShiftRecordService.findCurrentShiftRecord(
          storeId,
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
      );
    if (!targetShiftCompleted) {
      return targetShiftRecord;
    }

    return (
      (await this.handoverPageShiftRecordService.findNextShiftRecord(
        storeId,
        targetShiftRecord,
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
