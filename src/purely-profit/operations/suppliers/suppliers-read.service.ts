import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { resolvePagination } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ListSuppliersQueryDto,
  PaginatedSuppliersResponseDto,
} from './dto/supplier.dto';
import { SuppliersProfileService } from './suppliers-profile.service';

@Injectable()
export class SuppliersReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly suppliersProfileService: SuppliersProfileService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListSuppliersQueryDto,
  ): Promise<PaginatedSuppliersResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'supplier:view',
      '无权查看该门店供应商',
    );

    const { page, skip, take } = this.resolvePagination(
      query.page,
      query.pageSize,
    );

    if (storeId === null) {
      return this.suppliersProfileService.buildEmptyPaginatedResponse(
        page,
        take,
      );
    }

    const where = {
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
              { phone: { startsWith: query.keyword } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return this.suppliersProfileService.buildPaginatedResponse(
      items,
      page,
      take,
      total,
    );
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
