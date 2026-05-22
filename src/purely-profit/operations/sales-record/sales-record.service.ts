import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  buildPaginationMeta,
  getEndOfDay,
  getStartOfDay,
  toDecimalNumber,
  toOptionalText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateSalesRecordDto,
  ListSalesProductsQueryDto,
  ListSalesRecordsQueryDto,
  SalesDailyRowDto,
  SalesProductResponseDto,
  SalesRecordItemResponseDto,
  SalesRecordListResponseDto,
  SalesRecordResponseDto,
  SalesReportQueryDto,
  SalesReportResponseDto,
  SalesStatsQueryDto,
  SalesStatsResponseDto,
} from './dto/sales-record.dto';
import type { SalesRecordPeriodValue } from './sales-record.types';

interface SalesRecordQueryInput {
  storeId?: number;
  period?: SalesRecordPeriodValue;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
}

interface SalesReportAggregationRow {
  id: string;
  dateLabel: string;
  productName: string;
  quantity: number;
  revenue: number;
}

type SaleOrderWithItems = Prisma.SaleOrderGetPayload<{
  include: {
    items: {
      orderBy: [{ id: 'asc' }];
    };
  };
}>;

interface SalesPeriodRange {
  start: number;
  end: number;
}

interface SalesStatsAggregation {
  totalRevenue: number;
  totalProfit: number;
  orderCount: number;
}

interface CatalogProductRecord {
  id: number;
  name: string;
  category: string;
  code: string;
  price: Prisma.Decimal;
  profit: Prisma.Decimal;
  stock: number;
  isActive: boolean;
  image: string | null;
}

interface PreparedSalesItem {
  productId: number | null;
  productName: string;
  categoryName: string;
  salePrice: number;
  profit: number;
  quantity: number;
  countsTowardTotalQuantity: boolean;
  image?: string;
}

@Injectable()
export class SalesRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly inventoryService: InventoryService,
  ) {}

  async listProducts(
    user: AuthenticatedUser,
    query: ListSalesProductsQueryDto,
  ): Promise<SalesProductResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'sales:view',
      '无权查看该门店开始营业商品',
    );

    if (storeId === null) {
      return [];
    }

    const keyword = query.keyword;
    const category = keyword ? undefined : query.category;

    const products = await this.prisma.product.findMany({
      where: {
        storeId,
        isActive: true,
        ...(category ? { category } : {}),
        ...(keyword
          ? {
              OR: [
                {
                  name: {
                    contains: keyword,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  code: {
                    contains: keyword,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  category: {
                    contains: keyword,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        category: true,
        code: true,
        price: true,
        profit: true,
      },
    });

    return products.map((product) => ({
      id: String(product.id),
      name: product.name,
      category: product.category,
      code: product.code,
      price: toDecimalNumber(product.profit),
      salePrice: toDecimalNumber(product.price),
      quantity: 0,
    }));
  }

  async list(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'sales:view',
      '无权查看该门店销售记录',
    );

    if (storeId === null) {
      return {
        items: [],
        meta: buildPaginationMeta(0, 1, 1),
      };
    }

    const range = this.buildCurrentRange({
      storeId: query.storeId,
      period: query.period,
      year: query.year,
      customDate: query.customDate,
      rangeStartDate: query.rangeStartDate,
      rangeEndDate: query.rangeEndDate,
    });

    const orders = await this.prisma.saleOrder.findMany({
      where: {
        storeId,
        date: {
          gte: new Date(range.start),
          lte: new Date(range.end),
        },
      },
      include: {
        items: {
          orderBy: [{ id: 'asc' }],
        },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });

    const items = orders.map((order) => this.toSalesRecordResponse(order));

    return {
      items,
      meta: buildPaginationMeta(items.length, 1, Math.max(items.length, 1)),
    };
  }

  async listFrontendOrders(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordResponseDto[]> {
    const response = await this.list(user, {
      ...query,
      period: query.period ?? 'all',
    });

    return response.items;
  }

  async getStats(
    user: AuthenticatedUser,
    query: SalesStatsQueryDto,
  ): Promise<SalesStatsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'sales:view',
      '无权查看该门店销售统计',
    );

    if (storeId === null) {
      return {
        totalRevenue: 0,
        totalProfit: 0,
        orderCount: 0,
        avgOrderValue: 0,
        compareLastPeriod: null,
      };
    }

    const input: SalesRecordQueryInput = {
      storeId: query.storeId,
      period: query.period,
      year: query.year,
      customDate: query.customDate,
      rangeStartDate: query.rangeStartDate,
      rangeEndDate: query.rangeEndDate,
    };
    const currentRange = this.buildCurrentRange(input);
    const previousRange = this.buildPreviousRange(input, currentRange);

    const [currentStats, previousStats] = await Promise.all([
      this.aggregateOrderStats(storeId, currentRange),
      previousRange
        ? this.aggregateOrderStats(storeId, previousRange)
        : Promise.resolve<SalesStatsAggregation>({
            totalRevenue: 0,
            totalProfit: 0,
            orderCount: 0,
          }),
    ]);

    return {
      totalRevenue: currentStats.totalRevenue,
      totalProfit: currentStats.totalProfit,
      orderCount: currentStats.orderCount,
      avgOrderValue:
        currentStats.orderCount > 0
          ? Number(
              (currentStats.totalRevenue / currentStats.orderCount).toFixed(2),
            )
          : 0,
      compareLastPeriod:
        previousRange && previousStats.totalRevenue > 0
          ? Number(
              (
                ((currentStats.totalRevenue - previousStats.totalRevenue) /
                  previousStats.totalRevenue) *
                100
              ).toFixed(2),
            )
          : null,
    };
  }

  async getReport(
    user: AuthenticatedUser,
    query: SalesReportQueryDto,
  ): Promise<SalesReportResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店销售报表',
    );

    if (storeId === null) {
      return {
        summary: {
          totalQuantity: 0,
          totalRevenue: 0,
          orderCount: 0,
          avgOrderValue: 0,
        },
        dailySales: [],
      };
    }

    const range = this.buildCurrentRange({
      storeId: query.storeId,
      period: query.period,
      year: query.year,
      customDate: query.customDate,
      rangeStartDate: query.rangeStartDate,
      rangeEndDate: query.rangeEndDate,
    });
    const orders = await this.prisma.saleOrder.findMany({
      where: {
        storeId,
        date: {
          gte: new Date(range.start),
          lte: new Date(range.end),
        },
      },
      include: {
        items: {
          orderBy: [{ id: 'asc' }],
        },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });

    const totalQuantity = orders.reduce((sum, order) => sum + order.totalQuantity, 0);
    const totalRevenue = this.sumMoney(orders, (order) =>
      toDecimalNumber(order.totalRevenue),
    );
    const dailySales = this.aggregateReportRows(orders);
    const orderCount = dailySales.length;

    return {
      summary: {
        totalQuantity,
        totalRevenue,
        orderCount,
        avgOrderValue:
          orderCount > 0 ? Number((totalRevenue / orderCount).toFixed(2)) : 0,
      },
      dailySales,
    };
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateSalesRecordDto,
  ): Promise<SalesRecordResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'sales:create',
      '无权操作该门店销售记录',
    );
    const operatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    const preparedItems = await this.prepareItems(storeId, dto);
    const totalRevenue = this.sumMoney(
      preparedItems,
      (item) => item.salePrice * item.quantity,
    );
    const totalProfit = this.sumMoney(
      preparedItems,
      (item) => item.profit * item.quantity,
    );
    const totalQuantity = preparedItems.reduce(
      (sum, item) =>
        sum + (item.countsTowardTotalQuantity ? item.quantity : 0),
      0,
    );

    this.assertTotals(dto, totalRevenue, totalProfit, totalQuantity);

    const dateMs = dto.date ?? Date.now();
    const orderDate = new Date(dateMs);
    const note = toOptionalText(dto.note) ?? null;

    const created = await this.prisma.$transaction(async (transaction) => {
      const orderNo = await this.generateOrderNo(
        transaction,
        storeId,
        orderDate,
      );
      const createdOrder = await transaction.saleOrder.create({
        data: {
          storeId,
          operatorStaffId,
          orderNo,
          totalRevenue: new Prisma.Decimal(totalRevenue),
          totalProfit: new Prisma.Decimal(totalProfit),
          totalQuantity,
          paymentMethod: dto.paymentMethod,
          calcMode: dto.calcMode,
          note,
          date: orderDate,
          items: {
            create: preparedItems.map((item) => ({
              storeId,
              productId: item.productId,
              productName: item.productName,
              categoryName: item.categoryName,
              salePrice: new Prisma.Decimal(item.salePrice),
              profit: new Prisma.Decimal(item.profit),
              quantity: item.quantity,
              image: item.image ?? null,
            })),
          },
        },
        include: {
          items: {
            orderBy: [{ id: 'asc' }],
          },
        },
      });

      const stockItems = preparedItems
        .filter(
          (item): item is PreparedSalesItem & { productId: number } =>
            item.productId !== null,
        )
        .map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        }));

      if (stockItems.length > 0) {
        await this.inventoryService.recordSaleDeduction(transaction, {
          storeId,
          saleOrderId: createdOrder.id,
          operatorStaffId,
          items: stockItems,
        });
      }

      await transaction.financeCashFlowRecord.create({
        data: {
          storeId,
          saleOrderId: createdOrder.id,
          operatorStaffId,
          direction: 'income',
          category: 'sales',
          title: `${createdOrder.orderNo} 销售收入`,
          amount: new Prisma.Decimal(totalRevenue),
          payment: dto.paymentMethod,
          note,
          date: orderDate,
        },
      });

      return createdOrder;
    });

    return this.toSalesRecordResponse(created);
  }

  async remove(user: AuthenticatedUser, salesRecordId: number): Promise<void> {
    const record = await this.prisma.saleOrder.findUnique({
      where: { id: salesRecordId },
      select: { id: true, storeId: true },
    });

    if (!record) {
      throw new NotFoundException('销售记录不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      record.storeId,
      'sales:delete',
      '无权删除该销售记录',
    );

    await this.prisma.$transaction(async (transaction) => {
      await this.inventoryService.revertSaleDeduction(transaction, {
        storeId: record.storeId,
        saleOrderId: salesRecordId,
      });
      await transaction.financeCashFlowRecord.deleteMany({
        where: {
          storeId: record.storeId,
          saleOrderId: salesRecordId,
        },
      });
      await transaction.saleOrder.delete({
        where: { id: salesRecordId },
      });
    });
  }

  private async prepareItems(
    storeId: number,
    dto: CreateSalesRecordDto,
  ): Promise<PreparedSalesItem[]> {
    const numericProductIds = Array.from(
      new Set(
        dto.items
          .map((item) => this.parseNumericProductId(item.productId))
          .filter((item): item is number => item !== null),
      ),
    );

    const products: CatalogProductRecord[] = numericProductIds.length
      ? await this.prisma.product.findMany({
          where: {
            storeId,
            id: { in: numericProductIds },
          },
          select: {
            id: true,
            name: true,
            category: true,
            code: true,
            price: true,
            profit: true,
            stock: true,
            isActive: true,
            image: true,
          },
        })
      : [];
    const productMap = new Map(products.map((item) => [item.id, item]));

    if (productMap.size !== numericProductIds.length) {
      throw new NotFoundException('存在无效商品，无法创建销售记录');
    }

    return dto.items.map((item, index) => {
      const numericProductId = this.parseNumericProductId(item.productId);
      const matchedProduct =
        numericProductId === null
          ? null
          : (productMap.get(numericProductId) ?? null);
      const quantity = item.quantity;

      if (quantity <= 0) {
        throw new BadRequestException(`第 ${index + 1} 条销售数量必须大于 0`);
      }

      if (matchedProduct) {
        if (!matchedProduct.isActive) {
          throw new BadRequestException(
            `商品【${matchedProduct.name}】已下架，无法销售`,
          );
        }
        if (matchedProduct.stock < quantity) {
          throw new BadRequestException(
            `商品【${matchedProduct.name}】库存不足`,
          );
        }

        return {
          productId: matchedProduct.id,
          productName: matchedProduct.name,
          categoryName: matchedProduct.category,
          salePrice: this.normalizeMoney(
            toDecimalNumber(matchedProduct.price),
            '销售单价不能小于 0',
          ),
          profit: this.normalizeMoney(
            toDecimalNumber(matchedProduct.profit),
            '单件利润不能小于 0',
          ),
          quantity,
          countsTowardTotalQuantity: true,
          image: matchedProduct.image ?? undefined,
        };
      }

      const productName = item.productName.trim();
      const categoryName = item.categoryName.trim();
      const salePrice = this.normalizeSignedMoney(
        item.salePrice,
        '销售单价格式不正确',
      );
      const profit = this.normalizeSignedMoney(item.profit, '单件利润格式不正确');

      if (productName === '') {
        throw new BadRequestException(`第 ${index + 1} 条商品名称不能为空`);
      }
      if (categoryName === '') {
        throw new BadRequestException(`第 ${index + 1} 条商品分类不能为空`);
      }

      if ((salePrice < 0) !== (profit < 0)) {
        throw new BadRequestException(
          `第 ${index + 1} 条抵扣项销售额和利润必须同号`,
        );
      }

      return {
        productId: null,
        productName,
        categoryName,
        salePrice,
        profit,
        quantity,
        countsTowardTotalQuantity: salePrice >= 0 && profit >= 0,
      };
    });
  }

  private assertTotals(
    dto: CreateSalesRecordDto,
    totalRevenue: number,
    totalProfit: number,
    totalQuantity: number,
  ): void {
    if (!this.isSameMoney(dto.totalRevenue, totalRevenue)) {
      throw new BadRequestException('总营业额与明细汇总不一致');
    }
    if (!this.isSameMoney(dto.totalProfit, totalProfit)) {
      throw new BadRequestException('总利润与明细汇总不一致');
    }
    if (dto.totalQuantity !== totalQuantity) {
      throw new BadRequestException('总销售件数与明细汇总不一致');
    }
  }

  private async aggregateOrderStats(
    storeId: number,
    range: SalesPeriodRange,
  ): Promise<SalesStatsAggregation> {
    const aggregation = await this.prisma.saleOrder.aggregate({
      where: {
        storeId,
        date: {
          gte: new Date(range.start),
          lte: new Date(range.end),
        },
      },
      _count: { id: true },
      _sum: {
        totalRevenue: true,
        totalProfit: true,
      },
    });

    return {
      totalRevenue: toDecimalNumber(aggregation._sum.totalRevenue),
      totalProfit: toDecimalNumber(aggregation._sum.totalProfit),
      orderCount: aggregation._count.id,
    };
  }

  private buildCurrentRange(query: SalesRecordQueryInput): SalesPeriodRange {
    const period = query.period ?? 'today';
    const now = Date.now();

    switch (period) {
      case 'today':
        return {
          start: getStartOfDay(now).getTime(),
          end: now,
        };
      case 'week': {
        const start = new Date();
        const day = start.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        start.setDate(start.getDate() + diff);
        start.setHours(0, 0, 0, 0);
        return {
          start: start.getTime(),
          end: now,
        };
      }
      case 'month': {
        const current = new Date();
        return {
          start: new Date(
            current.getFullYear(),
            current.getMonth(),
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: now,
        };
      }
      case 'quarter': {
        const current = new Date();
        const quarterStartMonth = Math.floor(current.getMonth() / 3) * 3;
        return {
          start: new Date(
            current.getFullYear(),
            quarterStartMonth,
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: now,
        };
      }
      case 'year': {
        const year = query.year ?? new Date().getFullYear();
        return {
          start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
          end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
        };
      }
      case 'all':
        return {
          start: 0,
          end: now,
        };
      case 'custom_month': {
        if (query.customDate === undefined) {
          throw new BadRequestException('自定义单日模式需要传 customDate');
        }
        return {
          start: getStartOfDay(query.customDate).getTime(),
          end: getEndOfDay(query.customDate).getTime(),
        };
      }
      case 'custom_range': {
        if (
          query.rangeStartDate === undefined ||
          query.rangeEndDate === undefined
        ) {
          throw new BadRequestException(
            '自定义时间段模式需要同时传 rangeStartDate 和 rangeEndDate',
          );
        }
        const start = getStartOfDay(query.rangeStartDate).getTime();
        const end = getEndOfDay(query.rangeEndDate).getTime();
        return {
          start,
          end: Math.max(start, end),
        };
      }
      default:
        return {
          start: 0,
          end: now,
        };
    }
  }

  private buildPreviousRange(
    query: SalesRecordQueryInput,
    currentRange: SalesPeriodRange,
  ): SalesPeriodRange | undefined {
    const period = query.period ?? 'today';

    if (
      period === 'all' ||
      period === 'year' ||
      period === 'custom_month' ||
      period === 'custom_range'
    ) {
      return undefined;
    }

    if (period === 'month') {
      const currentStart = new Date(currentRange.start);
      const previousStart = new Date(
        currentStart.getFullYear(),
        currentStart.getMonth() - 1,
        1,
        0,
        0,
        0,
        0,
      );
      return {
        start: previousStart.getTime(),
        end: currentRange.start - 1,
      };
    }

    const duration = currentRange.end - currentRange.start;
    return {
      start: currentRange.start - duration - 1,
      end: currentRange.start - 1,
    };
  }

  private async generateOrderNo(
    client: Prisma.TransactionClient,
    storeId: number,
    date: Date,
  ): Promise<string> {
    const dayStart = getStartOfDay(date.getTime());
    const dayEnd = getEndOfDay(date.getTime());
    const count = await client.saleOrder.count({
      where: {
        storeId,
        date: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
    });

    return this.buildOrderNo(date, count + 1);
  }

  private buildOrderNo(date: Date, seq: number): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const serial = String(seq).padStart(3, '0');
    return `#${year}${month}${day}-${serial}`;
  }

  private aggregateReportRows(
    orders: SaleOrderWithItems[],
  ): SalesDailyRowDto[] {
    const rows = new Map<string, SalesReportAggregationRow>();

    for (const order of orders) {
      const dayStart = getStartOfDay(order.date.getTime()).getTime();
      const dateLabel = this.formatMonthDay(dayStart);

      for (const item of order.items) {
        const rowId = `${dayStart}-${item.productId ?? `manual_${item.productName}`}`;
        const revenue = this.sumMoney([item], (currentItem) =>
          toDecimalNumber(currentItem.salePrice) * currentItem.quantity,
        );
        const existing = rows.get(rowId);
        if (existing) {
          existing.quantity += item.quantity;
          existing.revenue = Number((existing.revenue + revenue).toFixed(2));
          continue;
        }
        rows.set(rowId, {
          id: rowId,
          dateLabel,
          productName: item.productName,
          quantity: item.quantity,
          revenue,
        });
      }
    }

    return Array.from(rows.values()).sort((left, right) => {
      if (left.id === right.id) {
        return 0;
      }
      return left.id > right.id ? -1 : 1;
    });
  }

  private toSalesRecordResponse(
    order: SaleOrderWithItems,
  ): SalesRecordResponseDto {
    const note = toOptionalText(order.note);

    return {
      id: String(order.id),
      orderNo: order.orderNo,
      items: order.items.map((item) => this.toSalesRecordItemResponse(item)),
      totalRevenue: toDecimalNumber(order.totalRevenue),
      totalProfit: toDecimalNumber(order.totalProfit),
      totalQuantity: order.totalQuantity,
      paymentMethod: order.paymentMethod,
      calcMode: order.calcMode,
      ...(note ? { note } : {}),
      date: toTimestampMs(order.date),
      createdAt: toTimestampMs(order.createdAt),
    };
  }

  private toSalesRecordItemResponse(
    item: SaleOrderWithItems['items'][number],
  ): SalesRecordItemResponseDto {
    return {
      productId:
        item.productId !== null ? String(item.productId) : `manual_${item.id}`,
      productName: item.productName,
      categoryName: item.categoryName,
      salePrice: toDecimalNumber(item.salePrice),
      profit: toDecimalNumber(item.profit),
      quantity: item.quantity,
    };
  }

  private parseNumericProductId(raw?: string): number | null {
    if (!raw) {
      return null;
    }

    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private formatMonthDay(timestamp: number): string {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  }

  private normalizeMoney(value: number, errorMessage: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(errorMessage);
    }
    return Number(value.toFixed(2));
  }

  private normalizeSignedMoney(value: number, errorMessage: string): number {
    if (!Number.isFinite(value)) {
      throw new BadRequestException(errorMessage);
    }
    return Number(value.toFixed(2));
  }

  private isSameMoney(left: number, right: number): boolean {
    return Math.abs(left - right) < 0.01;
  }

  private sumMoney<T>(items: T[], getter: (item: T) => number): number {
    return Number(
      items.reduce((sum, item) => sum + getter(item), 0).toFixed(2),
    );
  }
}
