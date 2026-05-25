export type MembershipRole = 'OWNER' | 'MANAGER' | 'STAFF';

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
  storeName: string;
  address: string | null;
  storeCreatedAt: Date;
  storeUpdatedAt: Date;
}
