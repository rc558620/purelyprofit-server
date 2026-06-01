import { HandoverMode, HandoverStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

export const createHandoverPrismaMock = () => ({
  employeeShift: {
    findFirst: jest.fn(),
  },
  saleOrder: {
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  saleOrderItem: {
    findMany: jest.fn(),
  },
  spaceSession: {
    aggregate: jest.fn(),
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
  storeHandoverRecord: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
});

export const createStoreSubAccountServiceMock = () => ({
  listAssignableHandoverCandidates: jest.fn(),
});

export const createOwnerUser = (): AuthenticatedUser => ({
  id: 1,
  email: 'boss@example.com',
  phone: '13800138000',
  name: '老板',
  createdAt: new Date('2026-05-12T00:00:00.000Z'),
  updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  currentMembership: {
    storeId: 100,
    subjectType: 'owner',
    role: 'OWNER',
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
  currentMembership: {
    storeId: 100,
    subjectType: 'sub_account',
    role: 'STAFF',
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

export const createManagerUser = (): AuthenticatedUser => ({
  id: 3,
  email: 'manager@example.com',
  phone: '13800138002',
  name: '经理',
  createdAt: new Date('2026-05-12T00:00:00.000Z'),
  updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  currentMembership: {
    storeId: 100,
    subjectType: 'staff',
    role: 'MANAGER',
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
