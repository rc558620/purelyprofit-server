import { StoreSubAccountRole, StoreSubAccountStatus } from '@prisma/client';

export interface StoreSubAccountSlotSummary {
  id: number;
  slotIndex: number;
  role: StoreSubAccountRole;
  status: StoreSubAccountStatus;
  isAssigned: boolean;
  employeeId: number | null;
  employeeName: string | null;
  canUseHandover: boolean;
  canAccessHome: boolean;
}

export interface StoreSubAccountRoleSummary {
  role: StoreSubAccountRole;
  activeCount: number;
  inactiveCount: number;
  disabledCount: number;
  assignedCount: number;
}

export interface StoreSubAccountSummary {
  quota: number;
  usedCount: number;
  availableCount: number;
  roleSummary: StoreSubAccountRoleSummary[];
  slots: StoreSubAccountSlotSummary[];
}

export interface UpdateStoreSubAccountSlotInput {
  slotIndex: number;
  role: StoreSubAccountRole;
  status?: StoreSubAccountStatus;
  employeeId?: number | null;
  canUseHandover?: boolean;
  canAccessHome?: boolean;
  loginAccount?: string;
  initialPassword?: string;
}
