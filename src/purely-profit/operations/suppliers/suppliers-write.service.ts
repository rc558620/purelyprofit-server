import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toOptionalText } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import type {
  CreateSupplierDto,
  SupplierResponseDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { SuppliersProfileService } from './suppliers-profile.service';

@Injectable()
export class SuppliersWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly suppliersProfileService: SuppliersProfileService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateSupplierDto,
  ): Promise<SupplierResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'supplier:create',
      '无权操作该门店供应商',
    );
    const name = dto.name.trim();

    await this.ensureSupplierNameUnique(storeId, name);

    let supplier;
    try {
      supplier = await this.prisma.supplier.create({
        data: {
          storeId,
          name,
          contact: toOptionalText(dto.contact) ?? null,
          phone: toOptionalText(dto.phone) ?? null,
          category: toOptionalText(dto.category) ?? null,
          note: toOptionalText(dto.note) ?? null,
        },
      });
    } catch (error: unknown) {
      // 并发场景下，两个请求同时通过 findFirst 检查后竞争 create，
      // 第二个请求会触发唯一约束 P2002 错误，需要友好转换
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('供应商名称已存在');
      }
      throw error;
    }

    await this.invalidateDashboardCaches(storeId);

    return this.suppliersProfileService.toSupplierResponse(supplier);
  }

  async update(
    user: AuthenticatedUser,
    supplierId: number,
    dto: UpdateSupplierDto,
  ): Promise<SupplierResponseDto> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) {
      throw new NotFoundException('供应商不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      supplier.storeId,
      'supplier:update',
      '无权操作该门店供应商',
    );

    const nextName = dto.name?.trim();
    if (dto.name !== undefined && nextName === '') {
      throw new BadRequestException('供应商名称不能为空');
    }
    if (nextName && nextName !== supplier.name) {
      await this.ensureSupplierNameUnique(
        supplier.storeId,
        nextName,
        supplier.id,
      );
    }

    let updated;
    try {
      updated = await this.prisma.supplier.update({
        where: { id: supplier.id },
        data: {
          ...(nextName && nextName !== '' ? { name: nextName } : {}),
          ...(dto.contact !== undefined
            ? { contact: toOptionalText(dto.contact) ?? null }
            : {}),
          ...(dto.phone !== undefined
            ? { phone: toOptionalText(dto.phone) ?? null }
            : {}),
          ...(dto.category !== undefined
            ? { category: toOptionalText(dto.category) ?? null }
            : {}),
          ...(dto.note !== undefined
            ? { note: toOptionalText(dto.note) ?? null }
            : {}),
        },
      });
    } catch (error: unknown) {
      // 并发场景下，两个请求同时通过 findFirst 检查后竞争 update，
      // 第二个请求会触发唯一约束 P2002 错误，需要友好转换
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('供应商名称已存在');
      }
      throw error;
    }

    await this.invalidateDashboardCaches(supplier.storeId);

    return this.suppliersProfileService.toSupplierResponse(updated);
  }

  async remove(user: AuthenticatedUser, supplierId: number): Promise<void> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!supplier) {
      throw new NotFoundException('供应商不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      supplier.storeId,
      'supplier:delete',
      '无权删除该门店供应商',
    );

    const linkedOrderCount = await this.prisma.purchaseOrder.count({
      where: { supplierId: supplier.id },
    });

    if (linkedOrderCount > 0) {
      throw new BadRequestException('该供应商下存在采购订单，无法删除');
    }

    await this.prisma.supplier.delete({
      where: { id: supplier.id },
    });

    await this.invalidateDashboardCaches(supplier.storeId);
  }

  private async ensureSupplierNameUnique(
    storeId: number,
    name: string,
    excludeSupplierId?: number,
  ): Promise<void> {
    const existing = await this.prisma.supplier.findFirst({
      where: {
        storeId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeSupplierId ? { id: { not: excludeSupplierId } } : {}),
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException('供应商名称已存在');
    }
  }

  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateProfitDashboardHome(storeId),
      this.cacheInvalidatorService.invalidatePulseDashboardOverview(storeId),
    ]);
  }
}
