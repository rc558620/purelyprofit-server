import type { SpaceWithRelations } from './spaces.mapper';

/** 管理操作用的 Space 记录（不含运行态 status，status 由运行态推导） */
export type ManagedSpaceRecord = Omit<SpaceWithRelations, 'status'> & {
  storeId: number;
};

export interface SpaceRemovalCandidate {
  id: number;
  storeId: number;
  sortOrder: number;
  _count: {
    /** 待履约预约数（status=pending） */
    reservations: number;
    /** 活跃会话数（status=active），>0 表示空间使用中，无法删除 */
    sessions: number;
  };
}

export interface ResolvedCreateSpaceRefs {
  typeId: number;
  zoneId: number | null;
}

export interface ResolvedUpdateSpaceRefs {
  typeId?: number;
  zoneId?: number | null;
}
