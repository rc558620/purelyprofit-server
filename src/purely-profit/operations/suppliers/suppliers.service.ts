import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toOptionalText, toTimestampMs } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  SupplierResponseDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListSuppliersQueryDto,
  ): Promise<SupplierResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'supplier:view',
      '无权查看该门店供应商',
    );

    if (storeId === null) {
      return [];
    }

    const items = await this.prisma.supplier.findMany({
      where: {
        storeId,
        ...(query.keyword
          ? {
              OR: [
                {
                  name: {
                    contains: query.keyword,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  contact: {
                    contains: query.keyword,
                    mode: 'insensitive' as const,
                  },
                },
                { phone: { contains: query.keyword } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    return items.map((item) => this.toSupplierResponse(item));
  }

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

    const existing = await this.prisma.supplier.findFirst({
      where: {
        storeId,
        name,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException('供应商名称已存在');
    }

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

    return this.toSupplierResponse(supplier);
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
      const duplicate = await this.prisma.supplier.findFirst({
        where: {
          storeId: supplier.storeId,
          name: nextName,
          id: { not: supplier.id },
        },
        select: {
          id: true,
        },
      });

      if (duplicate) {
        throw new ConflictException('供应商名称已存在');
      }
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

    return this.toSupplierResponse(updated);
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

  private toSupplierResponse(supplier: {
    id: number;
    name: string;
    contact: string | null;
    phone: string | null;
    category: string | null;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): SupplierResponseDto {
    return {
      id: String(supplier.id),
      name: supplier.name,
      ...(supplier.contact ? { contact: supplier.contact } : {}),
      ...(supplier.phone ? { phone: supplier.phone } : {}),
      ...(supplier.category ? { category: supplier.category } : {}),
      ...(supplier.note ? { note: supplier.note } : {}),
      createdAt: toTimestampMs(supplier.createdAt),
      updatedAt: toTimestampMs(supplier.updatedAt),
    };
  }
}
