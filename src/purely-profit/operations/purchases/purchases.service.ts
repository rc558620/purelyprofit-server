import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { resolvePagination } from '../../commerce/commerce.utils';
import { InventoryService } from '../../goods/inventory/inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { CostsService } from '../costs/costs.service';
import { Money } from '../../../shared/money.utils';
import type {
  CreatePurchaseDto,
  PaginatedPurchasesResponseDto,
  PreviewPurchaseDto,
  PurchasePreviewResponseDto,
  PurchaseResponseDto,
  PurchaseStatsResponseDto,
} from './dto/purchase.dto';
import {
  assertPurchaseSupplierInput,
  buildPurchaseCostTitle,
  buildPurchaseListWhere,
  createPurchaseProductMap,
  extractUniqueProductIds,
  normalizePurchaseNote,
  normalizePurchaseSupplierName,
  preparePurchaseItems,
  previewPurchaseAmounts,
  resolvePurchaseStatsRanges,
  sumPreparedPurchaseAmount,
} from './purchases.domain';
import {
  buildEmptyPaginatedPurchasesResponse,
  buildEmptyPurchaseStatsResponse,
  buildPaginatedPurchasesResponse,
  buildPurchaseStatsResponse,
  mapPreviewPurchaseResponse,
  mapPurchaseResponse,
} from './purchases.mapper';
import {
  aggregatePreviousPurchaseOrders,
  aggregatePurchaseOrders,
  countPurchaseOrders,
  countPurchaseSuppliers,
  createPurchaseOrderEntity,
  deletePurchaseOrderEntity,
  findPurchaseOrderAccessRecord,
  findPurchaseSupplier,
  queryPurchaseOrders,
  queryPurchaseProducts,
} from './purchases.query';
import type {
  PreparedPurchaseItem,
  PurchaseListQuery,
  PurchaseStatsQuery,
} from './purchases.types';
import type { PurchaseOrderWithItems } from './purchases.types';
import { PurchasesIdempotencyService } from './purchases-idempotency.service';

/** 建单可选参数：Idempotency-Key 由 controller 从请求头透传 */
export interface CreatePurchaseOptions {
  idempotencyKey?: string;
}

/** 建单前的校验结果：一次性解析出门店、供应商、明细与金额，供事务与幂等指纹复用 */
interface PreparedPurchaseCreate {
  storeId: number;
  operatorStaffId: number | null;
  supplierId: number | null;
  supplierName: string | null;
  preparedItems: PreparedPurchaseItem[];
  totalAmount: number;
  purchaseDate: Date;
  note: string | null;
}

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly costsService: CostsService,
    private readonly inventoryService: InventoryService,
    private readonly purchasesIdempotencyService: PurchasesIdempotencyService,
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
      return buildEmptyPaginatedPurchasesResponse(page, take);
    }

    const where = buildPurchaseListWhere(storeId, query);
    const [orders, total] = await Promise.all([
      queryPurchaseOrders(this.prisma, { where, skip, take }),
      countPurchaseOrders(this.prisma, where),
    ]);

    return buildPaginatedPurchasesResponse(orders, page, take, total);
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
      return buildEmptyPurchaseStatsResponse();
    }

    const { currentWhere, previousRange } = resolvePurchaseStatsRanges(
      storeId,
      query,
    );
    const [supplierCount, currentAgg, previousAgg] = await Promise.all([
      countPurchaseSuppliers(this.prisma, currentWhere),
      aggregatePurchaseOrders(this.prisma, currentWhere),
      aggregatePreviousPurchaseOrders(this.prisma, { storeId, previousRange }),
    ]);

    return buildPurchaseStatsResponse({
      supplierCount,
      currentCount: currentAgg._count.id,
      currentTotalAmount: currentAgg._sum.totalAmount,
      previousTotalAmount: previousAgg._sum.totalAmount,
      hasPreviousRange: previousRange !== undefined,
    });
  }

  async preview(
    user: AuthenticatedUser,
    dto: PreviewPurchaseDto,
  ): Promise<PurchasePreviewResponseDto> {
    // 与 create 保持一致：优先使用请求携带的 storeId，避免多门店下预览校验错门店
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'purchase:create',
      '无权操作该门店进货单',
    );

    const productIds = extractUniqueProductIds(dto.items);
    const productMap = createPurchaseProductMap(
      await queryPurchaseProducts(this.prisma, { storeId, productIds }),
      productIds,
    );
    const previewResult = previewPurchaseAmounts(dto.items, productMap);

    return mapPreviewPurchaseResponse(previewResult);
  }

  async create(
    user: AuthenticatedUser,
    dto: CreatePurchaseDto,
    options: CreatePurchaseOptions = {},
  ): Promise<PurchaseResponseDto> {
    const prepared = await this.prepareCreatePurchase(user, dto);

    // 幂等键可选：未传时保持旧行为（兼容尚未升级的客户端），传了则整条路径受保护
    const idempotencyKey = this.purchasesIdempotencyService.normalizeKey(
      options.idempotencyKey,
    );
    const requestHash =
      idempotencyKey === null
        ? null
        : this.purchasesIdempotencyService.hashRequest({
            storeId: prepared.storeId,
            dto,
          });

    if (idempotencyKey !== null && requestHash !== null) {
      const replayed = await this.findIdempotentReplay(
        user.id,
        idempotencyKey,
        requestHash,
      );
      if (replayed) {
        return replayed;
      }
    }

    const claimed =
      idempotencyKey !== null && requestHash !== null
        ? await this.claimIdempotentCreate(
            user.id,
            idempotencyKey,
            requestHash,
          )
        : { placeholderId: null };
    if ('replay' in claimed) {
      return claimed.replay;
    }

    let created: PurchaseOrderWithItems;
    try {
      created = await this.createPurchaseInTransaction(prepared);
    } catch (error) {
      // 明确失败才释放占位：让客户端用同一个 key 安全重试
      if (claimed.placeholderId !== null) {
        await this.purchasesIdempotencyService.discard(
          claimed.placeholderId,
        );
      }
      throw error;
    }

    const response = mapPurchaseResponse(created);
    if (claimed.placeholderId !== null) {
      await this.purchasesIdempotencyService.finalize(
        claimed.placeholderId,
        response,
      );
    }

    await this.invalidateCachesAfterWrite(prepared.storeId);

    return response;
  }

  async remove(user: AuthenticatedUser, purchaseId: number): Promise<void> {
    const purchase = await findPurchaseOrderAccessRecord(
      this.prisma,
      purchaseId,
    );

    if (!purchase) {
      throw new NotFoundException('进货单不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      purchase.storeId,
      'purchase:delete',
      '无权删除该门店进货单',
    );

    await this.prisma.$transaction(async (transaction) => {
      // 先回滚该进货单的入库库存（删除日志 + 反向扣减），再删单。
      // 库存无法完整回滚时这里抛 409，整笔删除失败，单据/流水/成本保持原样。
      await this.inventoryService.revertPurchaseRestock(transaction, {
        storeId: purchase.storeId,
        purchaseOrderId: purchase.id,
      });
      await this.costsService.deletePurchaseCostRecord(
        transaction,
        purchase.storeId,
        purchase.id,
      );
      await deletePurchaseOrderEntity(transaction, purchase.id);
    });

    await this.invalidateCachesAfterWrite(purchase.storeId);
  }

  /** 建单前置校验：解析门店、供应商、商品、单位与金额，并校验业务日期。 */
  private async prepareCreatePurchase(
    user: AuthenticatedUser,
    dto: CreatePurchaseDto,
  ): Promise<PreparedPurchaseCreate> {
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

    const normalizedSupplierName = normalizePurchaseSupplierName(
      dto.supplierName,
    );
    const note = normalizePurchaseNote(dto.note);
    assertPurchaseSupplierInput(dto.supplierId, normalizedSupplierName);

    const supplier = dto.supplierId
      ? await findPurchaseSupplier(this.prisma, {
          storeId,
          supplierId: dto.supplierId,
        })
      : null;

    if (dto.supplierId && !supplier) {
      throw new NotFoundException('供应商不存在');
    }

    const productIds = extractUniqueProductIds(dto.items);
    const productMap = createPurchaseProductMap(
      await queryPurchaseProducts(this.prisma, { storeId, productIds }),
      productIds,
    );
    const preparedItems = preparePurchaseItems(dto.items, productMap);
    const totalAmount = sumPreparedPurchaseAmount(preparedItems);

    return {
      storeId,
      operatorStaffId,
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? normalizedSupplierName,
      preparedItems,
      totalAmount,
      purchaseDate: this.resolvePurchaseDate(dto.date),
      note,
    };
  }

  /** 业务日期校验：非法值或未来时间都会污染成本统计周期。 */
  private resolvePurchaseDate(timestamp: number): Date {
    const purchaseDate = new Date(timestamp);

    if (!Number.isFinite(purchaseDate.getTime())) {
      throw new BadRequestException('进货日期不合法');
    }

    // 与手动成本记录保持一致：进货日期不允许晚于当前时间，
    // 否则会生成“未来成本记录”，导致成本统计/报表在当前周期缺失、未来周期突增。
    if (purchaseDate.getTime() > Date.now()) {
      throw new BadRequestException('进货日期不能晚于当前时间');
    }

    return purchaseDate;
  }

  /** 单事务写入：进货单 + 入库 + 成本，任一失败整笔回滚。 */
  private createPurchaseInTransaction(
    prepared: PreparedPurchaseCreate,
  ): Promise<PurchaseOrderWithItems> {
    const {
      storeId,
      operatorStaffId,
      supplierId,
      supplierName,
      preparedItems,
      totalAmount,
      purchaseDate,
      note,
    } = prepared;

    return this.prisma.$transaction(async (transaction) => {
      const order = await createPurchaseOrderEntity(transaction, {
        storeId,
        supplierId,
        supplierName,
        operatorStaffId,
        totalAmount,
        date: purchaseDate,
        note,
        items: preparedItems,
      });

      // 进货即入库：与订单在同一事务内同步库存，避免前端补偿导致的丢失/重复入库
      await this.inventoryService.recordPurchaseRestock(transaction, {
        storeId,
        operatorStaffId,
        purchaseOrderId: order.id,
        // 无码商品（productId 为空）无库存可入，跳过
        items: preparedItems
          .filter(
            (item): item is typeof item & { productId: number } =>
              item.productId !== null,
          )
          .map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
      });

      await this.costsService.syncPurchaseCost(transaction, {
        storeId,
        operatorStaffId,
        purchaseOrderId: order.id,
        // totalAmount 是分，syncPurchaseCost 期望元（内部会调用 toCostDbCents 转分）
        amount: Money.fromDbCents(totalAmount).toOutputYuan(),
        title: buildPurchaseCostTitle(supplierName),
        note,
        date: purchaseDate,
      });

      return order;
    });
  }

  /** 幂等命中：返回首次建单的响应快照，或提示首次请求仍在处理中。 */
  private async findIdempotentReplay(
    actorId: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PurchaseResponseDto | null> {
    const record = await this.purchasesIdempotencyService.find(
      actorId,
      idempotencyKey,
    );

    if (!record) {
      return null;
    }

    this.purchasesIdempotencyService.ensureSameRequest(record, requestHash);
    return this.purchasesIdempotencyService.resolveReplay(record);
  }

  /**
   * 抢占幂等键。并发双击时后到者撞唯一键，回读记录：
   * 已成功就回放，仍在处理则返回 409（客户端换/同 key 重试都安全）。
   */
  private async claimIdempotentCreate(
    actorId: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{ placeholderId: number | null } | { replay: PurchaseResponseDto }> {
    try {
      const placeholderId = await this.purchasesIdempotencyService.claim(
        actorId,
        idempotencyKey,
        requestHash,
      );
      return { placeholderId };
    } catch (error) {
      if (!this.purchasesIdempotencyService.isDuplicateKeyError(error)) {
        throw error;
      }

      const replay = await this.findIdempotentReplay(
        actorId,
        idempotencyKey,
        requestHash,
      );
      return { replay: replay ?? this.throwIdempotencyInFlight() };
    }
  }

  /** 撞键后回读不到已完成快照：首次请求仍在写，明确要求稍后重试。 */
  private throwIdempotencyInFlight(): never {
    throw new BadRequestException('该进货单正在创建中，请稍后重试');
  }

  /**
   * 写操作后的派生缓存失效。
   *
   * 缓存只是加速层：进货单、库存、成本已经提交，失效失败不能回显成「保存失败」，
   * 否则用户重试就会重复入库/重复记账。因此逐项降级为 warn 日志。
   */
  private async invalidateCachesAfterWrite(storeId: number): Promise<void> {
    const tasks: Array<[string, () => Promise<unknown>]> = [
      [
        '利润看板首页',
        () =>
          this.cacheInvalidatorService.invalidateProfitDashboardHome(storeId),
      ],
      [
        '经营分析概览',
        () =>
          this.cacheInvalidatorService.invalidatePulseDashboardOverview(
            storeId,
          ),
      ],
      // 采购会同步沉淀成本记录，失效成本仪表盘/统计/报表缓存，避免展示旧数据
      ['成本统计', () => this.costsService.invalidateCostCaches(storeId)],
    ];

    await Promise.all(
      tasks.map(async ([name, run]) => {
        try {
          await run();
        } catch (error) {
          this.logger.warn(
            `进货单写操作后失效「${name}」缓存失败 storeId=${storeId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
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
