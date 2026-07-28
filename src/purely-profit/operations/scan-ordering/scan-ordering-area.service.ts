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
  CreateScanOrderingAreaDto,
  UpdateScanOrderingAreaDto,
} from './dto/scan-ordering-area.dto';

/** 商家扫码点餐桌台区域管理服务。 */
@Injectable()
export class ScanOrderingAreaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async list(user: AuthenticatedUser): Promise<
    Array<{
      id: number;
      name: string;
      sortOrder: number;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const storeId = await this.resolveStoreId(user);
    return this.prisma.scanOrderingArea.findMany({
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
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateScanOrderingAreaDto,
  ): Promise<{
    id: number;
    name: string;
    sortOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const storeId = await this.resolveStoreId(user);
    const existingArea = await this.prisma.scanOrderingArea.findUnique({
      where: { storeId_name: { storeId, name: dto.name } },
      select: { id: true },
    });
    if (existingArea) {
      throw new ConflictException('扫码点餐区域已存在');
    }
    return this.prisma.scanOrderingArea.create({
      data: { storeId, name: dto.name, sortOrder: dto.sortOrder ?? 0 },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async update(
    user: AuthenticatedUser,
    areaId: number,
    dto: UpdateScanOrderingAreaDto,
  ): Promise<{
    id: number;
    name: string;
    sortOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const storeId = await this.resolveStoreId(user);
    try {
      const result = await this.prisma.scanOrderingArea.updateMany({
        where: { id: areaId, storeId: storeId },
        data: dto,
      });
      if (result.count === 0) {
        // 检查是 ID 不存在还是 StoreId 不匹配
        const exists = await this.prisma.scanOrderingArea.findUnique({
          where: { id: areaId },
          select: { id: true },
        });
        if (!exists) {
          throw new NotFoundException(`扫码点餐区域不存在 (ID: ${areaId})`);
        } else {
          throw new ForbiddenException('无权操作该区域');
        }
      }

      // 返回更新后的完整记录
      const updatedArea = await this.prisma.scanOrderingArea.findFirst({
        where: { id: areaId, storeId },
        select: {
          id: true,
          name: true,
          sortOrder: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!updatedArea) {
        throw new InternalServerErrorException('更新成功后无法读取区域数据');
      }

      return updatedArea;
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

  async remove(user: AuthenticatedUser, areaId: number): Promise<void> {
    const storeId = await this.resolveStoreId(user);
    const tableCount = await this.prisma.scanOrderingTable.count({
      where: { storeId: storeId, areaId, deletedAt: null },
    });
    if (tableCount > 0) {
      throw new ConflictException(`区域仍包含 ${tableCount} 个桌台，无法删除`);
    }
    try {
      const result = await this.prisma.scanOrderingArea.deleteMany({
        where: { id: areaId, storeId: storeId },
      });
      if (result.count === 0) {
        throw new NotFoundException(`扫码点餐区域不存在（ID: ${areaId})`);
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`扫码点餐区域不存在（ID: ${areaId})`);
      }
      throw error;
    }
  }

  private resolveStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:table-manage',
      '无权管理扫码点餐区域',
    );
  }
}
