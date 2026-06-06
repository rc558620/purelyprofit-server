import { EmployeeShiftType, Prisma, SalesPaymentMethod } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { HandoverShiftInfoDto } from './dto/handover-page.dto';

export type MembershipContext = NonNullable<
  AuthenticatedUser['currentMembership']
>;

export type DisplayOperatorInfo = {
  name: string | null;
  avatar?: string;
  staffId: number | null;
};

export type OwnedShiftSelection = {
  isCashier: boolean;
  cashierEmployeeId: number | null;
  ownedExactShiftRecord: ShiftRecordRow | null;
};

export type ShiftRecordRow = {
  id?: number;
  employeeId?: number | null;
  employeeName: string;
  shiftType: EmployeeShiftType | null;
  shiftName?: string | null;
  date: Date;
  startTime: string;
  endTime: string;
  createdAt?: Date;
};

export type HandoverOperationAccess = {
  canOperate: boolean;
  blockedReason: string | null;
};

export const HANDOVER_RECORD_INCLUDE =
  Prisma.validator<Prisma.StoreHandoverRecordInclude>()({
    fromEmployee: { select: { id: true, name: true } },
    toEmployee: { select: { id: true, name: true } },
    additionalValues: {
      select: {
        id: true,
        itemId: true,
        value: true,
        createdAt: true,
        updatedAt: true,
        item: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    },
  });

export type HandoverRecordSnapshotFields = {
  employeeShiftIdSnapshot?: number | null;
  fromEmployeeNameSnapshot?: string | null;
  shiftTypeSnapshot?: EmployeeShiftType | null;
  shiftNameSnapshot?: string | null;
  shiftStartTimeSnapshot?: string | null;
  shiftEndTimeSnapshot?: string | null;
};

export type HandoverRecordRow = Prisma.StoreHandoverRecordGetPayload<{
  include: typeof HANDOVER_RECORD_INCLUDE;
}> &
  HandoverRecordSnapshotFields;

export type AdditionalItemRow = {
  id: number;
  name: string;
  val?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type OrderItemRow = {
  id: number;
  productName: string;
  salePrice: Prisma.Decimal;
  quantity: number;
  product: { stock: number; unit: string } | null;
  order: {
    id: number;
    date: Date;
    paymentMethod: SalesPaymentMethod;
    spaceSession: {
      prepaidPaymentMethod: SalesPaymentMethod | null;
      renewRecords: Prisma.JsonValue;
    } | null;
  };
};

export type RefundOrderRow = {
  id: number;
  date: Date;
  paymentMethod: SalesPaymentMethod;
  totalRevenue: Prisma.Decimal;
  spaceSession: {
    space: {
      name: string;
    };
  } | null;
};

export type ShiftDateRange = {
  startAt: Date;
  endAt: Date;
};

export type RecordShiftSnapshot = {
  employeeId?: number | null;
  employeeName?: string | null;
  shiftType: EmployeeShiftType | null;
  shiftName?: string | null;
  startTime: string;
  endTime: string;
};

export type RecordViewContext = {
  referenceDate: Date;
  shiftRecord: RecordShiftSnapshot | null;
  shiftRange: ShiftDateRange;
  operatorName: string;
  operatorStaffId: number | null;
  operatorAvatar: string | null;
};

export type ReceiverCandidate = {
  employeeId: number;
  employeeName: string;
  subAccountId: number | null;
  shiftDate?: Date;
  shiftStartTime?: string;
  shiftEndTime?: string;
};

export type ResolvedPageShiftSelection = {
  ownedSelection: OwnedShiftSelection;
  shiftRecord: ShiftRecordRow | null;
  operationShiftRecord: ShiftRecordRow | null;
};

export type ResolvedHandoverPageShiftContext = {
  membership: MembershipContext;
  shiftRecord: ShiftRecordRow | null;
  shiftInfo: HandoverShiftInfoDto;
  operationAccess: HandoverOperationAccess;
  displayOperatorStaffId: number | null;
  receiverCandidate: ReceiverCandidate | null;
  handoverCompletedAndNoUpcomingShift: boolean;
};
