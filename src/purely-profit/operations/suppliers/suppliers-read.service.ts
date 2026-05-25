import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ListSuppliersQueryDto,
  SupplierResponseDto,
} from './dto/supplier.dto';
import { SuppliersProfileService } from './suppliers-profile.service';

@Injectable()
export class SuppliersReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly suppliersProfileService: SuppliersProfileService,
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

    return items.map((item) =>
      this.suppliersProfileService.toSupplierResponse(item),
    );
  }
}
