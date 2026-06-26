import {
  EmployeeShiftType,
  HandoverMode,
  HandoverStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

export const createHandoverPrismaMock = () => {
  const prisma = {
    $executeRaw: jest.fn(),
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    employeeShift: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    saleOrder: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    saleOrderItem: {
      findMany: jest.fn(),
    },
    spaceSession: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    financeCashFlowRecord: {
      aggregate: jest.fn(),
    },
    storeHandoverAdditionalItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    storeHandoverAdditionalValue: {
      findMany: jest.fn(),
    },
    storeHandoverRecord: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };

  return {
    ...prisma,
    $transaction: jest.fn((input: unknown) => {
      if (typeof input === 'function') {
        return Promise.resolve(
          (input as (client: typeof prisma) => unknown)(prisma),
        );
      }
      return Promise.resolve(input);
    }),
  };
};

export const createStoreSubAccountServiceMock = () => ({
  listAssignableHandoverCandidates: jest.fn(),
  findAssignedSubAccountByEmployee: jest.fn(),
});

export const createOwnerUser = (): AuthenticatedUser => ({
  id: 1,
  email: 'boss@example.com',
  phone: '13800138000',
  name: '老板',
  createdAt: new Date('2026-05-12T00:00:00.000Z'),
  updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  lastActiveAt: null,
  currentMembership: {
    storeId: 100,
    subjectType: 'owner',
    role: 'owner',
    staffId: 1,
    linkedEmployeeId: 10,
    subAccountId: null,
    permissions: ['*'],
    isActive: true,
    subAccountRole: null,
    subAccountStatus: null,
    subAccountAssigned: false,
    canAccessHome: true,
    canUseHandover: true,
  },
});

export const createSubAccountUser = (): AuthenticatedUser => ({
  id: 2,
  email: 'staff@example.com',
  phone: '13800138001',
  name: '员工A',
  createdAt: new Date('2026-05-12T00:00:00.000Z'),
  updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  lastActiveAt: null,
  currentMembership: {
    storeId: 100,
    subjectType: 'sub_account',
    role: 'staff',
    staffId: 2,
    linkedEmployeeId: 20,
    subAccountId: 5,
    permissions: ['handover:view', 'handover:create'],
    isActive: true,
    subAccountRole: 'cashier',
    subAccountStatus: 'active',
    subAccountAssigned: true,
    canAccessHome: true,
    canUseHandover: true,
  },
});

export const createCashierUser = (input?: {
  name?: string;
  staffId?: number;
  linkedEmployeeId?: number | null;
}): AuthenticatedUser => {
  const user = createSubAccountUser();

  return {
    ...user,
    name: input?.name ?? user.name,
    currentMembership: {
      ...user.currentMembership!,
      staffId: input?.staffId ?? user.currentMembership!.staffId,
      linkedEmployeeId:
        input && 'linkedEmployeeId' in input
          ? (input.linkedEmployeeId ?? null)
          : user.currentMembership!.linkedEmployeeId,
    },
  };
};

export type TestShiftRecord = {
  id: number;
  employeeId: number;
  employeeName: string;
  shiftType: EmployeeShiftType;
  shiftName?: string | null;
  date: Date;
  startTime: string;
  endTime: string;
  createdAt: Date;
};

export const createShiftRecord = (
  input?: Partial<TestShiftRecord>,
): TestShiftRecord => ({
  id: input?.id ?? 1,
  employeeId: input?.employeeId ?? 20,
  employeeName: input?.employeeName ?? '员工A',
  shiftType: input?.shiftType ?? EmployeeShiftType.morning,
  ...(input && 'shiftName' in input
    ? { shiftName: input.shiftName ?? null }
    : {}),
  date: input?.date ?? new Date('2026-06-02T00:00:00.000Z'),
  startTime: input?.startTime ?? '09:00',
  endTime: input?.endTime ?? '18:00',
  createdAt: input?.createdAt ?? new Date('2026-06-02T00:00:00.000Z'),
});

export const createEmployeeProfile = (input?: {
  name?: string;
  avatar?: string | null;
  linkedStaffId?: number | null;
  linkedStaffAvatar?: string | null;
}) => ({
  name: input?.name ?? '员工A',
  avatar: input?.avatar ?? null,
  linkedStaffId: input?.linkedStaffId ?? null,
  linkedStaff:
    input && 'linkedStaffAvatar' in input
      ? {
          user: {
            avatar: input.linkedStaffAvatar ?? null,
          },
        }
      : null,
});

export const createManagerUser = (): AuthenticatedUser => ({
  id: 3,
  email: 'manager@example.com',
  phone: '13800138002',
  name: '经理',
  createdAt: new Date('2026-05-12T00:00:00.000Z'),
  updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  lastActiveAt: null,
  currentMembership: {
    storeId: 100,
    subjectType: 'staff',
    role: 'manager',
    staffId: 3,
    linkedEmployeeId: 30,
    subAccountId: null,
    permissions: ['*'],
    isActive: true,
    subAccountRole: null,
    subAccountStatus: null,
    subAccountAssigned: false,
    canAccessHome: true,
    canUseHandover: true,
  },
});

export const createMockRecord = () => ({
  id: 1,
  storeId: 100,
  fromEmployeeId: 10,
  toEmployeeId: 20,
  fromSubAccountId: null,
  toSubAccountId: null,
  actorStaffId: 1,
  handoverMode: HandoverMode.sub_account,
  status: HandoverStatus.pending,
  note: '测试交班',
  reason: null,
  handoverAt: null,
  createdAt: new Date('2026-05-13T10:00:00.000Z'),
  updatedAt: new Date('2026-05-13T10:00:00.000Z'),
  fromEmployee: { id: 10, name: '老板' },
  toEmployee: { id: 20, name: '员工A' },
  additionalValues: [],
});

export const createMockCandidates = () => [
  {
    employeeId: 20,
    employeeName: '员工A',
    subAccountId: 5,
    slotIndex: 1,
    role: 'cashier',
  },
  {
    employeeId: 30,
    employeeName: '经理',
    subAccountId: 6,
    slotIndex: 2,
    role: 'finance',
  },
];
