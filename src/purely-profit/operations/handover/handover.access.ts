import { ForbiddenException } from '@nestjs/common';
import {
  EmployeeShiftType,
  StaffRole,
  StoreSubAccountRole,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE } from './handover.constants';
import type {
  HandoverOperationAccess,
  MembershipContext,
  ShiftRecordRow,
} from './handover.types';

export const ensureMembershipContext = (
  user: AuthenticatedUser,
): NonNullable<AuthenticatedUser['currentMembership']> => {
  if (!user.currentMembership) {
    throw new ForbiddenException('当前账号暂无门店权限');
  }
  return user.currentMembership;
};

export const ensureMembershipStoreId = (user: AuthenticatedUser): number =>
  ensureMembershipContext(user).storeId;

export const isCashierMembership = (membership: MembershipContext): boolean =>
  membership.subjectType === 'sub_account' &&
  membership.subAccountRole === StoreSubAccountRole.cashier;

export const isManagerMembership = (membership: MembershipContext): boolean =>
  membership.role === StaffRole.manager ||
  membership.subAccountRole === StoreSubAccountRole.manager;

export const resolveHandoverOperationAccess = (params: {
  membership: MembershipContext;
  ownedShiftRecord: ShiftRecordRow | null;
  ownedShiftCompleted: boolean;
  requestedShiftType?: EmployeeShiftType;
}): HandoverOperationAccess => {
  const {
    membership,
    ownedShiftRecord,
    ownedShiftCompleted,
    requestedShiftType,
  } = params;

  if (membership.subjectType === 'owner') {
    return {
      canOperate: true,
      blockedReason: null,
    };
  }

  const isCashier = isCashierMembership(membership);
  const isManager = isManagerMembership(membership);
  const missingEmployeeReason = isCashier
    ? '当前收银员账号未关联员工，暂不允许操作'
    : '当前员工账号未关联员工，暂不允许操作';
  const wrongShiftReason = isCashier
    ? CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE
    : '当前班次不属于该员工，暂不允许操作';
  const noShiftReason = isCashier
    ? '当前时段没有该收银员本人班次，暂不允许操作'
    : '当前时段没有该员工本人班次，暂不允许操作';
  const managerNoShiftReason = requestedShiftType
    ? '当前班次暂无可交班员工，暂不允许操作'
    : '当前时段暂无可交班班次，暂不允许操作';

  if (ownedShiftCompleted) {
    return {
      canOperate: false,
      blockedReason: '当前班次已完成交班，暂不允许重复操作',
    };
  }
  if (isManager) {
    return ownedShiftRecord
      ? {
          canOperate: true,
          blockedReason: null,
        }
      : {
          canOperate: false,
          blockedReason: managerNoShiftReason,
        };
  }
  if (!membership.linkedEmployeeId) {
    return {
      canOperate: false,
      blockedReason: missingEmployeeReason,
    };
  }
  if (ownedShiftRecord?.employeeId === membership.linkedEmployeeId) {
    return {
      canOperate: true,
      blockedReason: null,
    };
  }

  return {
    canOperate: false,
    blockedReason: requestedShiftType ? wrongShiftReason : noShiftReason,
  };
};
