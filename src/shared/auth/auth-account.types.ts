export type AuthProductScope = 'purely_profit' | 'purely_club';

export type AuthenticatedAccountScope = AuthProductScope | 'developer';

/**
 * JWT aud（audience）字段值，标识 token 签发时的产品线上下文。
 * 在 Guard 层进行 audience 二次校验，防止 token 跨产品线使用。
 */
export type TokenAudience = 'purely_profit' | 'purely_club' | 'developer';

export type AuthPulseMode = 'normal' | 'developer';

/** 会话类别，决定并发会话数量限制 */
export type SessionCategory =
  | 'owner'
  | 'profit_main'
  | 'profit_sub'
  | 'profit_club';

export interface AccountIdentifiers {
  phone: string;
  email: string;
  accountScope: AuthenticatedAccountScope;
  /** 登录时命中的 Staff ID，用于 membership 精确解析（可选，仅 purely_profit 登录时携带） */
  staffId?: number;
}

export interface PhoneUserRecord {
  id: number;
  email: string;
  password: string;
  phone: string;
  accountScope: AuthenticatedAccountScope;
  /** 登录时命中的 Staff ID（可选，仅通过 Staff 查找时携带） */
  staffId?: number;
}

export interface AuthResolvedIdentity {
  accountScope: AuthenticatedAccountScope;
  isPulseDeveloper: boolean;
  pulseMode: AuthPulseMode;
}

export interface AuthMembershipContextRow {
  id: number;
  storeId: number;
  userId: number | null;
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
  /** 门店业态（catering/general），用于子账号角色按业态解析权限集 */
  businessMode?: import('@prisma/client').StoreBusinessMode | null;
}
