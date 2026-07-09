import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toTimestampMs } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateSpaceZoneDto,
  ListSpaceZonesQueryDto,
  type SpaceZoneResponseDto,
  UpdateSpaceZoneDto,
} from './dto/space-zone.dto';

interface SpaceZoneRecord {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SpaceZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async listSpaceZones(
    user: AuthenticatedUser,
    query: ListSpaceZonesQueryDto,
  ): Promise<SpaceZoneResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间区域',
    );

    if (storeId === null) {
      return [];
    }

    const items = await this.prisma.spaceZone.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceZoneResponse(item));
  }

  async createSpaceZone(
    user: AuthenticatedUser,
    dto: CreateSpaceZoneDto,
  ): Promise<SpaceZoneResponseDto> {
    // 空间区域配置属于门店运营配置，仅允许主账号操作，子账号均被拒绝。
    this.ensurePrimaryAccountOnly(user);
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'space:create',
      '无权操作该门店空间区域',
    );
    const name = dto.name.trim();

    const duplicate = await this.prisma.spaceZone.findFirst({
      where: { storeId, name },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('空间区域名称已存在');
    }

    const item = await this.prisma.spaceZone.create({
      data: { storeId, name },
    });

    return this.toSpaceZoneResponse(item);
  }

  async updateSpaceZone(
    user: AuthenticatedUser,
    zoneId: number,
    dto: UpdateSpaceZoneDto,
  ): Promise<SpaceZoneResponseDto> {
    // 空间区域配置写操作仅允许主账号，子账号均被拒绝（同 createSpaceZone）。
    this.ensurePrimaryAccountOnly(user);
    const item = await this.prisma.spaceZone.findUnique({
      where: { id: zoneId },
    });

    if (!item) {
      throw new NotFoundException('空间区域不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:update',
      '无权操作该门店空间区域',
    );

    const name = dto.name.trim();
    if (name !== item.name) {
      const duplicate = await this.prisma.spaceZone.findFirst({
        where: {
          storeId: item.storeId,
          name,
          id: { not: item.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException('空间区域名称已存在');
      }
    }

    const updated = await this.prisma.spaceZone.update({
      where: { id: item.id },
      data: { name },
    });

    return this.toSpaceZoneResponse(updated);
  }

  async resolveSpaceZoneByName(
    storeId: number,
    rawName: string | undefined,
  ): Promise<{ id: number; name: string } | null> {
    const name = rawName?.trim();
    if (!name) {
      return null;
    }

    const zone = await this.prisma.spaceZone.findFirst({
      where: { storeId, name },
      select: {
        id: true,
        name: true,
      },
    });

    if (!zone) {
      throw new NotFoundException('空间区域不存在');
    }

    return zone;
  }

  async removeSpaceZone(
    user: AuthenticatedUser,
    zoneId: number,
  ): Promise<void> {
    // 空间区域配置写操作仅允许主账号，子账号均被拒绝（同 createSpaceZone）。
    this.ensurePrimaryAccountOnly(user);
    const item = await this.prisma.spaceZone.findUnique({
      where: { id: zoneId },
      select: {
        id: true,
        storeId: true,
        _count: {
          // B-5 fix: 统计所有空间引用（含软删除），
          // 避免物理删除区域时 SetNull 清空软删除空间的 zoneId 导致审计数据丢失
          select: { spaces: true },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('空间区域不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:delete',
      '无权删除该门店空间区域',
    );

    if (item._count.spaces > 0) {
      throw new ConflictException('该空间区域仍被空间引用，无法删除');
    }

    await this.prisma.spaceZone.delete({
      where: { id: item.id },
    });
  }

  /**
   * 断言当前请求者为主账号（identityType 为 owner 或 staff）。
   * 空间区域配置属于门店运营配置，仅对主账号开放，
   * 任何子账号身份（收銀员 / 店长 / 财务）均不允许操作，以保持最小权限原则。
   */
  private ensurePrimaryAccountOnly(user: AuthenticatedUser): void {
    if (user.currentMembership?.subjectType === 'sub_account') {
      throw new ForbiddenException('子账号不可维护空间区域配置');
    }
  }

  toSpaceZoneResponse(item: SpaceZoneRecord): SpaceZoneResponseDto {
    return {
      id: String(item.id),
      name: item.name,
      createdAt: toTimestampMs(item.createdAt),
      updatedAt: toTimestampMs(item.updatedAt),
    };
  }
}
