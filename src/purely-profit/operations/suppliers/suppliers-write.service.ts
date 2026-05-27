import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toOptionalText } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
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

    const supplier = await this.prisma.supplier.create({
      data: {
        storeId,
        name,
        contact: toOptionalText(dto.contact) ?? null,
        phone: toOptionalText(dto.phone) ?? null,
        category: toOptionalText(dto.category) ?? null,
        note: toOptionalText(dto.note) ?? null,
      },
    });

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
    if (nextName && nextName !== supplier.name) {
      await this.ensureSupplierNameUnique(
        supplier.storeId,
        nextName,
        supplier.id,
      );
    }

    const updated = await this.prisma.supplier.update({
      where: { id: supplier.id },
      data: {
        ...(nextName ? { name: nextName } : {}),
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

    await this.prisma.supplier.delete({
      where: { id: supplier.id },
    });
  }

  private async ensureSupplierNameUnique(
    storeId: number,
    name: string,
    excludeSupplierId?: number,
  ): Promise<void> {
    const existing = await this.prisma.supplier.findFirst({
      where: {
        storeId,
        name,
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
}
