import type { IdentityType } from '../access-control/access-control.service';
import type { StoreSubAccountRole } from '@prisma/client';

export type MembershipRole = 'owner' | 'manager' | 'staff';

export interface ProfileUserRecord {
  id: number;
  email: string;
  name: string | null;
  avatar: string | null;
  realName: string | null;
  idNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileMembershipRecord {
  staffId: number;
  storeId: number;
  role: MembershipRole;
  permissions: string[];
  isActive: boolean;
  identityType?: IdentityType;
  subAccountRole?: StoreSubAccountRole | null;
  storeName: string;
  address: string | null;
  /// 门店业态：catering=餐饮，general=非餐饮
  businessMode: 'catering' | 'general';
  storeCreatedAt: Date;
  storeUpdatedAt: Date;
}
