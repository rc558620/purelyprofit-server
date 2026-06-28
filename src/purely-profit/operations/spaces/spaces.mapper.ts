import { toTimestampMs } from '../../commerce/commerce.utils';
import type { SpaceResponseDto } from './dto/space.dto';
import type { SpaceStatusValue } from './spaces.constants';

export type SpaceWithRelations = {
  id: number;
  name: string;
  capacity: number | null;
  enableDirtyRoom: boolean;
  autoCheckout: boolean;
  /** 脏房清洁完成时间：markSpaceReady 时更新，用于运行态推导 cleaning 状态 */
  cleanedAt: Date | null;
  /** 运行态推导状态：占用中/预约中/清洁中/空闲，由查询层聚合后注入 */
  status: SpaceStatusValue;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  type: {
    id: number;
    name: string;
  };
  zone: {
    id: number;
    name: string;
  } | null;
};

export function toSpaceResponse(space: SpaceWithRelations): SpaceResponseDto {
  return {
    id: String(space.id),
    name: space.name,
    type: space.type.name,
    ...(space.zone
      ? {
          zone: space.zone.name,
        }
      : {}),
    ...(space.capacity !== null ? { capacity: space.capacity } : {}),
    enableDirtyRoom: space.enableDirtyRoom,
    autoCheckout: space.autoCheckout,
    status: space.status,
    sortOrder: space.sortOrder,
    createdAt: toTimestampMs(space.createdAt),
  };
}
