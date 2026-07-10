import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toTimestampMs } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateSpaceTypeDto,
  ListSpaceTypesQueryDto,
  type SpaceTypeResponseDto,
  UpdateSpaceTypeDto,
} from './dto/space-type.dto';

interface SpaceTypeRecord {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SpaceTypesService {
  private readonly logger = new Logger(SpaceTypesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async listSpaceTypes(
    user: AuthenticatedUser,
    query: ListSpaceTypesQueryDto,
  ): Promise<SpaceTypeResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间类型',
    );

    if (storeId === null) {
      return [];
    }

    const items = await this.prisma.spaceType.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceTypeResponse(item));
  }

  async createSpaceType(
    user: AuthenticatedUser,
    dto: CreateSpaceTypeDto,
  ): Promise<SpaceTypeResponseDto> {
    // 空间类型配置属于门店运营配置，仅允许主账号操作，子账号均被拒绝。
    this.ensurePrimaryAccountOnly(user);
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'space:create',
      '无权操作该门店空间类型',
    );
    const name = dto.name.trim();

    const duplicate = await this.prisma.spaceType.findFirst({
      where: { storeId, name },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('空间类型名称已存在');
    }

    let item;
    try {
      item = await this.prisma.spaceType.create({
        data: { storeId, name },
      });
    } catch (err) {
      // BUG-01 fix: 并发创建同名类型触发 @@unique([storeId, name]) 约束，
      // 将 Prisma P2002 归一化为业务友好的 409 ConflictException
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('空间类型名称已存在');
      }
      throw err;
    }

    return this.toSpaceTypeResponse(item);
  }

  async updateSpaceType(
    user: AuthenticatedUser,
    typeId: number,
    dto: UpdateSpaceTypeDto,
  ): Promise<SpaceTypeResponseDto> {
    // 空间类型配置写操作仅允许主账号，子账号均被拒绝（同 createSpaceType）。
    this.ensurePrimaryAccountOnly(user);
    const item = await this.prisma.spaceType.findUnique({
      where: { id: typeId },
    });

    if (!item) {
      throw new NotFoundException('空间类型不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:update',
      '无权操作该门店空间类型',
    );

    const name = dto.name.trim();
    if (name !== item.name) {
      const duplicate = await this.prisma.spaceType.findFirst({
        where: {
          storeId: item.storeId,
          name,
          id: { not: item.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException('空间类型名称已存在');
      }
    }

    const updated = await this.prisma.spaceType.update({
      where: { id: item.id },
      data: { name },
    });

    return this.toSpaceTypeResponse(updated);
  }

  async resolveSpaceTypeByName(
    storeId: number,
    rawName: string,
  ): Promise<{ id: number; name: string }> {
    const name = rawName.trim();
    const type = await this.prisma.spaceType.findFirst({
      where: { storeId, name },
      select: {
        id: true,
        name: true,
      },
    });

    if (!type) {
      // BUG-06 fix: 引用字段不存在应返回 400（请求体参数无效），而非 404（资源不存在）
      throw new BadRequestException(
        `空间类型「${name}」不存在，请先通过 POST /space-types 创建`,
      );
    }

    return type;
  }

  async removeSpaceType(
    user: AuthenticatedUser,
    typeId: number,
  ): Promise<void> {
    // 空间类型配置写操作仅允许主账号，子账号均被拒绝（同 createSpaceType）。
    this.ensurePrimaryAccountOnly(user);
    const item = await this.prisma.spaceType.findUnique({
      where: { id: typeId },
      select: {
        id: true,
        storeId: true,
        _count: {
          select: { spaces: { where: { deletedAt: null } } },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('空间类型不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:delete',
      '无权删除该门店空间类型',
    );

    if (item._count.spaces > 0) {
      throw new ConflictException('该空间类型已被空间使用，无法删除');
    }

    try {
      await this.prisma.spaceType.delete({
        where: { id: item.id },
      });
    } catch (err) {
      // B-2 fix: 捕获 FK 约束错误（软删除空间仍持有 typeId 引用时触发）
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        this.logger.warn(
          `空间类型 ${item.id} 删除失败：仍被空间引用（含已删除空间）`,
        );
        throw new ConflictException(
          '该空间类型仍被空间引用（含已删除空间），无法删除',
        );
      }
      throw err;
    }
  }

  /**
   * 断言当前请求者为主账号（identityType 为 owner 或 staff）。
   * 空间类型配置属于门店运营配置，仅对主账号开放，
   * 任何子账号身份（收銀员 / 店长 / 财务）均不允许操作，以保持最小权限原则。
   */
  private ensurePrimaryAccountOnly(user: AuthenticatedUser): void {
    if (user.currentMembership?.subjectType === 'sub_account') {
      throw new ForbiddenException('子账号不可维护空间类型配置');
    }
  }

  toSpaceTypeResponse(item: SpaceTypeRecord): SpaceTypeResponseDto {
    return {
      id: String(item.id),
      name: item.name,
      createdAt: toTimestampMs(item.createdAt),
      updatedAt: toTimestampMs(item.updatedAt),
    };
  }
}
