export type AuthProductScope = 'purely_profit' | 'purely_club';

export type AuthenticatedAccountScope = AuthProductScope | 'developer';

export type AuthPulseMode = 'normal' | 'developer';

export interface AccountIdentifiers {
  phone: string;
  email: string;
  accountScope: AuthenticatedAccountScope;
}

export interface PhoneUserRecord {
  id: number;
  email: string;
  password: string;
  phone: string;
  accountScope: AuthenticatedAccountScope;
}

export interface AuthResolvedIdentity {
  accountScope: AuthenticatedAccountScope;
  isPulseDeveloper: boolean;
  pulseMode: AuthPulseMode;
}

export interface AuthMembershipContextRow {
  id: number;
  storeId: number;
  role: import('@prisma/client').StaffRole;
  permissions: string[];
  isActive: boolean;
  linkedEmployeeId: number | null;
  subAccountId: number | null;
  subAccountRole: import('@prisma/client').StoreSubAccountRole | null;
  subAccountStatus: import('@prisma/client').StoreSubAccountStatus | null;
  subAccountAssigned: boolean | null;
  subAccountCanAccessHome: boolean | null;
  subAccountCanUseHandover: boolean | null;
}
