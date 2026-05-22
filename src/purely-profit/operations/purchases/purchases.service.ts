import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  buildPaginationMeta,
  buildPreviousPurchaseDateRange,
  buildPurchaseDateRange,
  resolvePagination,
  toDecimalNumber,
  toOptionalText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { CostsService } from '../costs/costs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreatePurchaseDto,
  ListPurchasesQueryDto,
  PaginatedPurchasesResponseDto,
  PurchaseItemResponseDto,
  PurchaseResponseDto,
  PurchaseStatsQueryDto,
  PurchaseStatsResponseDto,
} from './dto/purchase.dto';

interface PurchaseListQuery {
  storeId?: number;
  period?: ListPurchasesQueryDto['period'];
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
  page?: number;
  pageSize?: number;
}

interface PurchaseStatsQuery {
  storeId?: number;
  period?: PurchaseStatsQueryDto['period'];
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
}

interface PurchaseProductRecord {
  id: number;
  name: string;
  unit: string;
}

interface PreparedPurchaseItem {
  productId: number | null;
  productName: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

type PurchaseOrderWithItems = Prisma.PurchaseOrderGetPayload<{
  include: {
    items: {
      orderBy: [{ id: 'asc' }];
    };
  };
}>;

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly costsService: CostsService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: PurchaseListQuery,
  ): Promise<PaginatedPurchasesResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'purchase:view',
      '无权查看该门店进货单',
    );
    const { page, skip, take } = this.resolvePagination(
      query.page,
      query.pageSize,
    );

    if (storeId === null) {
      return {
        items: [],
        meta: buildPaginationMeta(0, page, take),
      };
    }

    const dateRange = buildPurchaseDateRange(
      query.period,
      query.customDate,
      query.rangeStartDate,
      query.rangeEndDate,
    );

    const where: Prisma.PurchaseOrderWhereInput = {
      storeId,
      ...(dateRange ? { date: dateRange } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          items: {
            orderBy: [{ id: 'asc' }],
          },
        },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toPurchaseResponse(item)),
      meta: buildPaginationMeta(total, page, take),
    };
  }

  async getStats(
    user: AuthenticatedUser,
    query: PurchaseStatsQuery,
  ): Promise<PurchaseStatsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'purchase:view',
      '无权查看该门店进货统计',
    );

    if (storeId === null) {
      return {
        totalThisMonth: 0,
        countThisMonth: 0,
        supplierCount: 0,
        compareLastMonth: null,
      };
    }

    const currentRange = buildPurchaseDateRange(
      query.period,
      query.customDate,
      query.rangeStartDate,
      query.rangeEndDate,
    );
    const previousRange = buildPreviousPurchaseDateRange(currentRange);

    const [supplierCount, currentAgg, previousAgg] = await Promise.all([
      this.prisma.supplier.count({ where: { storeId } }),
      this.prisma.purchaseOrder.aggregate({
        where: {
          storeId,
          ...(currentRange ? { date: currentRange } : {}),
        },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      previousRange
        ? this.prisma.purchaseOrder.aggregate({
            where: {
              storeId,
              date: previousRange,
            },
            _sum: { totalAmount: true },
          })
        : Promise.resolve({ _sum: { totalAmount: null } }),
    ]);

    const currentTotal = toDecimalNumber(currentAgg._sum.totalAmount);
    const previousTotal = toDecimalNumber(previousAgg._sum.totalAmount);
    const compareLastMonth =
      previousRange && previousTotal > 0
        ? Number(
            (((currentTotal - previousTotal) / previousTotal) * 100).toFixed(2),
          )
        : null;

    return {
      totalThisMonth: currentTotal,
      countThisMonth: currentAgg._count.id,
      supplierCount,
      compareLastMonth,
    };
  }

  async create(
    user: AuthenticatedUser,
    dto: CreatePurchaseDto,
  ): Promise<PurchaseResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'purchase:create',
      '无权操作该门店进货单',
    );
    const operatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    const normalizedSupplierName = toOptionalText(dto.supplierName);
    if (!dto.supplierId && !normalizedSupplierName) {
      throw new BadRequestException('请选择供应商或填写供应商名称');
    }

    const supplier = dto.supplierId
      ? await this.prisma.supplier.findFirst({
          where: {
            id: dto.supplierId,
            storeId,
          },
        })
      : null;

    if (dto.supplierId && !supplier) {
      throw new NotFoundException('供应商不存在');
    }

    const productIds = this.extractUniqueProductIds(dto.items);

    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: {
            storeId,
            id: { in: productIds },
          },
          select: {
            id: true,
            name: true,
            unit: true,
          },
        })
      : [];

    const productMap = new Map<number, PurchaseProductRecord>(
      products.map((item) => [item.id, item]),
    );
    if (productMap.size !== productIds.length) {
      throw new NotFoundException('存在无效商品');
    }

    const preparedItems = dto.items.map((item) =>
      this.preparePurchaseItem(item, productMap),
    );

    const totalAmount = Number(
      preparedItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
    );

    const created = await this.prisma.$transaction(async (transaction) => {
      const order = await transaction.purchaseOrder.create({
        data: {
          storeId,
          supplierId: supplier?.id ?? null,
          supplierName: supplier?.name ?? normalizedSupplierName ?? null,
          operatorStaffId,
          totalAmount,
          date: new Date(dto.date),
          note: toOptionalText(dto.note) ?? null,
          items: {
            create: preparedItems.map((item) => ({
              storeId,
              productId: item.productId,
              productName: item.productName,
              unit: item.unit,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              amount: item.amount,
            })),
          },
        },
        include: {
          items: {
            orderBy: [{ id: 'asc' }],
          },
        },
      });

      await this.costsService.syncPurchaseCost(transaction, {
        storeId,
        operatorStaffId,
        purchaseOrderId: order.id,
        amount: totalAmount,
        title: supplier?.name ? `${supplier.name}进货成本` : '进货成本',
        note: toOptionalText(dto.note) ?? null,
        date: new Date(dto.date),
      });

      return order;
    });

    return this.toPurchaseResponse(created);
  }

  async remove(user: AuthenticatedUser, purchaseId: number): Promise<void> {
    const purchase = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseId },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!purchase) {
      throw new NotFoundException('进货单不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      purchase.storeId,
      'purchase:delete',
      '无权删除该门店进货单',
    );

    await this.prisma.purchaseOrder.delete({
      where: { id: purchase.id },
    });
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }

  private toPurchaseResponse(
    order: PurchaseOrderWithItems,
  ): PurchaseResponseDto {
    return {
      id: String(order.id),
      ...(order.supplierId ? { supplierId: String(order.supplierId) } : {}),
      ...(order.supplierName ? { supplierName: order.supplierName } : {}),
      items: order.items.map((item) => this.toPurchaseItemResponse(item)),
      totalAmount: toDecimalNumber(order.totalAmount),
      date: toTimestampMs(order.date),
      ...(order.note ? { note: order.note } : {}),
      createdAt: toTimestampMs(order.createdAt),
    };
  }

  private extractUniqueProductIds(
    items: CreatePurchaseDto['items'],
  ): number[] {
    const productIds = items
      .map((item) => item.productId)
      .filter((productId): productId is number => productId !== undefined);
    const uniqueProductIds = Array.from(new Set(productIds));

    if (uniqueProductIds.length !== productIds.length) {
      throw new ConflictException('同一商品请合并成一条进货明细');
    }

    return uniqueProductIds;
  }

  private preparePurchaseItem(
    item: CreatePurchaseDto['items'][number],
    productMap: Map<number, PurchaseProductRecord>,
  ): PreparedPurchaseItem {
    const product =
      item.productId !== undefined ? productMap.get(item.productId) : undefined;

    if (item.productId !== undefined && !product) {
      throw new NotFoundException('存在无效商品');
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new BadRequestException('进货单价不能为负数');
    }

    const productName = toOptionalText(item.productName) ?? product?.name;
    if (!productName) {
      throw new BadRequestException('无码商品必须填写商品名称');
    }

    return {
      productId: product?.id ?? null,
      productName,
      unit: toOptionalText(item.unit) ?? product?.unit ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: Number((item.quantity * item.unitPrice).toFixed(2)),
    };
  }

  private toPurchaseItemResponse(item: {
    id: number;
    productId: number | null;
    productName: string;
    unit: string | null;
    quantity: number;
    unitPrice: Prisma.Decimal;
    amount: Prisma.Decimal;
  }): PurchaseItemResponseDto {
    return {
      id: String(item.id),
      ...(item.productId ? { productId: String(item.productId) } : {}),
      productName: item.productName,
      ...(item.unit ? { unit: item.unit } : {}),
      quantity: item.quantity,
      unitPrice: toDecimalNumber(item.unitPrice),
      amount: toDecimalNumber(item.amount),
    };
  }
}
