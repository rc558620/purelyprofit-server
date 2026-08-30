import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  CreateScanOrderingTypeDto,
  UpdateScanOrderingTypeDto,
} from './dto/scan-ordering-type.dto';

/** 扫码点餐桌台类型响应。 */
export interface ScanOrderingTypeResponse {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: number;
  updatedAt?: number;
}

/** 商家扫码点餐桌台类型管理服务。 */
@Injectable()
export class ScanOrderingTypeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async list(user: AuthenticatedUser): Promise<ScanOrderingTypeResponse[]> {
    const storeId = await this.resolveStoreId(user);

    const types = await this.prisma.scanOrderingType.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return types.map((type) => ({
      id: type.id,
      name: type.name,
      sortOrder: type.sortOrder,
      isActive: type.isActive,
      createdAt: type.createdAt.getTime(),
      updatedAt: type.updatedAt?.getTime(),
    }));
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateScanOrderingTypeDto,
  ): Promise<ScanOrderingTypeResponse> {
    const storeId = await this.resolveConfigStoreId(user);

    const existingType = await this.prisma.scanOrderingType.findUnique({
      where: { storeId_name: { storeId, name: dto.name } },
      select: { id: true },
    });

    if (existingType) {
      throw new ConflictException('扫码点餐类型已存在');
    }

    const type = await this.prisma.scanOrderingType.create({
      data: {
        storeId,
        name: dto.name,
        sortOrder: dto.sortOrder ?? 0,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      id: type.id,
      name: type.name,
      sortOrder: type.sortOrder,
      isActive: type.isActive,
      createdAt: type.createdAt.getTime(),
      updatedAt: type.updatedAt?.getTime(),
    };
  }

  async update(
    user: AuthenticatedUser,
    typeId: number,
    dto: UpdateScanOrderingTypeDto,
  ): Promise<void> {
    const storeId = await this.resolveConfigStoreId(user);

    try {
      const result = await this.prisma.scanOrderingType.updateMany({
        where: { id: typeId, storeId: storeId },
        data: dto,
      });

      if (result.count === 0) {
        // 检查是 ID 不存在还是 StoreId 不匹配
        const exists = await this.prisma.scanOrderingType.findUnique({
          where: { id: typeId },
          select: { id: true },
        });

        if (!exists) {
          throw new NotFoundException(`扫码点餐类型不存在（ID: ${typeId})`);
        } else {
          throw new ForbiddenException('无权操作该类型');
        }
      }
    } catch (error) {
      // Prisma 查询错误（如连接失败）
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2025')
      ) {
        throw new InternalServerErrorException(
          '数据库引用约束错误或资源不存在',
        );
      }
      throw error;
    }
  }

  async remove(user: AuthenticatedUser, typeId: number): Promise<void> {
    const storeId = await this.resolveConfigStoreId(user);

    // 检查是否有桌台使用该类型
    const tableCount = await this.prisma.scanOrderingTable.count({
      where: { storeId: storeId, typeId, deletedAt: null },
    });

    if (tableCount > 0) {
      throw new ConflictException(`类型仍包含 ${tableCount} 个桌台，无法删除`);
    }

    try {
      const result = await this.prisma.scanOrderingType.deleteMany({
        where: { id: typeId, storeId: storeId },
      });

      if (result.count === 0) {
        throw new NotFoundException(`扫码点餐类型不存在（ID: ${typeId})`);
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`扫码点餐类型不存在（ID: ${typeId})`);
      }
      throw error;
    }
  }

  private resolveStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:table-manage',
      '无权管理扫码点餐类型',
    );
  }

  private resolveConfigStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:table-config',
      '无权配置扫码点餐类型',
    );
  }
}
