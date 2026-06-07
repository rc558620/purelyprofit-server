import { Injectable } from '@nestjs/common';
import type { CreateSpaceDto, UpdateSpaceDto } from './dto/space.dto';
import { SpaceTypesService } from './space-types.service';
import { SpaceZonesService } from './space-zones.service';
import type {
  ResolvedCreateSpaceRefs,
  ResolvedUpdateSpaceRefs,
} from './spaces.types';

@Injectable()
export class SpacesRefResolverService {
  constructor(
    private readonly spaceTypesService: SpaceTypesService,
    private readonly spaceZonesService: SpaceZonesService,
  ) {}

  async resolveCreateSpaceRefs(
    storeId: number,
    dto: CreateSpaceDto,
  ): Promise<ResolvedCreateSpaceRefs> {
    const [type, zone] = await Promise.all([
      this.spaceTypesService.resolveSpaceTypeByName(storeId, dto.type),
      dto.zone !== undefined
        ? this.spaceZonesService.resolveSpaceZoneByName(storeId, dto.zone)
        : Promise.resolve(null),
    ]);

    return {
      typeId: type.id,
      zoneId: zone?.id ?? null,
    };
  }

  async resolveUpdateSpaceRefs(
    storeId: number,
    dto: UpdateSpaceDto,
  ): Promise<ResolvedUpdateSpaceRefs> {
    const [type, zone] = await Promise.all([
      dto.type !== undefined
        ? this.spaceTypesService.resolveSpaceTypeByName(storeId, dto.type)
        : Promise.resolve(null),
      dto.zone !== undefined
        ? this.spaceZonesService.resolveSpaceZoneByName(storeId, dto.zone)
        : Promise.resolve(null),
    ]);

    return {
      ...(dto.type !== undefined && type ? { typeId: type.id } : {}),
      ...(dto.zone !== undefined ? { zoneId: zone?.id ?? null } : {}),
    };
  }
}
