import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { assertGeneralStoreForSelfOrdering } from './club-self-ordering.utils';
import {
  CreateSelfOrderDto,
  SelfOrderItemInputDto,
} from './dto/create-self-order.dto';
import {
  createSelfOrderNo,
  hashSelfOrderRequest,
} from './club-self-ordering.utils';

const IDEMPOTENCY_SCOPE = 'club:self-order:create';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * processing 占位记录的存活租约：进程在占位插入后崩溃/超时会留下永不完成的
 * processing 记录，阻塞同键重试直到 TTL。超过租约视为过期删除并允许重建——
 * 任何存活事务远早于 60s 完成，删除只可能命中崩溃残留，不会误删在途兄弟请求。
 */
const IDEMPOTENCY_PROCESSING_LEASE_MS = 60 * 1000;
/** 待支付订单有效期：超时后不再允许发起支付 */
export const SELF_ORDER_PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;

/** 定价后的订单行（含服务端重算的价格与商品快照） */
export interface PricedSelfOrderItem {
  productId: string;
  productName: string;
  categoryName: string | null;
  /** 销售单价（分） */
  salePrice: number;
  /** 成本单价（分） */
  costPrice: number;
  quantity: number;
}

/**
 * 自助下单建单服务
 *
 * 相比扫码点餐刻意简化：无服务端购物车、无规格、无库存预留、无优惠/积分，
 * 价格一律由服务端按 Product 重算并落快照（不信任客户端传价）。
 * 保留的五件套：幂等键 + 事务 + 乐观锁 version + 会话校验 + 事务内建单。
 */
@Injectable()
export class ClubSelfOrderingOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentStoreContextService: ClubCurrentStoreContextService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateSelfOrderDto,
    idempotencyKey: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new ConflictException('请提供有效的 Idempotency-Key 以创建订单');
    }
    const key = idempotencyKey.trim();

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_actorId_idempotencyKey: {
          scope: IDEMPOTENCY_SCOPE,
          actorId: user.id,
          idempotencyKey: key,
        },
      },
    });
    // 崩溃残留的 processing 占位：超过租约后删除并重建，避免同键在 TTL 内被永久阻塞
    if (
      existing?.status === 'processing' &&
      Date.now() - existing.updatedAt.getTime() >
        IDEMPOTENCY_PROCESSING_LEASE_MS
    ) {
      await this.prisma.idempotencyRecord.deleteMany({
        where: {
          scope: IDEMPOTENCY_SCOPE,
          actorId: user.id,
          idempotencyKey: key,
          status: 'processing',
          updatedAt: {
            lt: new Date(Date.now() - IDEMPOTENCY_PROCESSING_LEASE_MS),
          },
        },
      });
    } else if (existing) {
      return this.resolveExistingIdempotency(existing);
    }

    const currentContext =
      await this.currentStoreContextService.requireCurrentContext(user);
    const storeId = currentContext.store.id;

    // 与扫码定位/菜单同一道业态门禁：餐饮门店走既有扫码点餐链路
    assertGeneralStoreForSelfOrdering(currentContext.store);

    // 会话必须 active 且属于当前门店：杜绝把订单挂到别家门店或已结账的会话
    const session = await this.prisma.spaceSession.findFirst({
      where: { id: dto.sessionId, storeId, status: 'active' },
      select: { id: true, spaceId: true },
    });
    if (!session) {
      throw new ForbiddenException('当前空间会话不可用，请重新扫码');
    }

    const priced = await this.priceItems(storeId, dto.items);
    const orderNo = createSelfOrderNo();

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 先插占位记录抢占唯一索引，并发的兄弟请求会在此失败并走幂等回放
        await tx.idempotencyRecord.create({
          data: {
            scope: IDEMPOTENCY_SCOPE,
            actorId: user.id,
            idempotencyKey: key,
            requestHash: hashSelfOrderRequest({
              sessionId: dto.sessionId,
              // 用定价后的结果：同商品多行已合并，避免因行顺序不同算出不同指纹
              items: priced.items.map((item) => [
                item.productId,
                item.quantity,
              ]),
              remark: dto.remark ?? null,
            }),
            status: 'processing',
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });

        const order = await tx.selfOrder.create({
          data: {
            storeId,
            orderNo,
            sessionId: session.id,
            spaceId: session.spaceId,
            clubUserId: user.id,
            remark: dto.remark?.trim() || null,
            idempotencyKey: key,
            itemTotalAmount: priced.itemTotalAmount,
            payableAmount: priced.payableAmount,
            status: 'pending_payment',
            paymentStatus: 'unpaid',
            items: {
              create: priced.items.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                categoryName: item.categoryName,
                salePrice: item.salePrice,
                costPrice: item.costPrice,
                quantity: item.quantity,
              })),
            },
          },
          include: { items: true },
        });

        const response = this.toOrderResponse(order);
        await tx.idempotencyRecord.update({
          where: {
            scope_actorId_idempotencyKey: {
              scope: IDEMPOTENCY_SCOPE,
              actorId: user.id,
              idempotencyKey: key,
            },
          },
          data: {
            status: 'succeeded',
            resourceType: 'self_order',
            resourceId: order.id,
            responseSnapshot: response as unknown as Prisma.InputJsonValue,
          },
        });

        return response;
      });
    } catch (error) {
      // 唯一键冲突等并发场景：兄弟请求可能已建单成功，回放其结果
      if (!(error instanceof ConflictException)) {
        const created = await this.prisma.idempotencyRecord.findUnique({
          where: {
            scope_actorId_idempotencyKey: {
              scope: IDEMPOTENCY_SCOPE,
              actorId: user.id,
              idempotencyKey: key,
            },
          },
        });
        if (created) return this.resolveExistingIdempotency(created);
      }
      throw error;
    }
  }

  /** 查询订单详情（带归属校验） */
  async findOwnedOrder(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<Record<string, unknown>> {
    const order = await this.prisma.selfOrder.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    return this.toOrderResponse(order);
  }

  /** 会话维度的历史订单（供菜单页/订单列表使用） */
  async listBySession(
    user: AuthenticatedUser,
    sessionId: number,
  ): Promise<Record<string, unknown>[]> {
    const orders = await this.prisma.selfOrder.findMany({
      where: { sessionId, clubUserId: user.id, deletedAt: null },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return orders.map((order) => this.toOrderResponse(order));
  }

  /**
   * 商品定价与快照
   * 同一商品多行时先合并数量；价格、名称、分类名一律取自商品库当前值并落快照
   */
  private async priceItems(
    storeId: number,
    inputs: SelfOrderItemInputDto[],
  ): Promise<{
    items: PricedSelfOrderItem[];
    itemTotalAmount: number;
    payableAmount: number;
  }> {
    const mergedQuantity = new Map<string, number>();
    for (const input of inputs) {
      mergedQuantity.set(
        input.productId,
        (mergedQuantity.get(input.productId) ?? 0) + input.quantity,
      );
    }

    const productIds = [...mergedQuantity.keys()]
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        storeId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        category: true,
        price: true,
        costPrice: true,
      },
    });
    const productMap = new Map(
      products.map((product) => [product.id, product]),
    );

    const items: PricedSelfOrderItem[] = [];
    for (const [productId, quantity] of mergedQuantity) {
      const product = productMap.get(Number(productId));
      if (!product) {
        throw new NotFoundException('购物车中存在已下架商品，请刷新后重试');
      }
      items.push({
        productId,
        productName: product.name,
        categoryName: product.category ?? null,
        salePrice: product.price,
        costPrice: product.costPrice ?? 0,
        quantity,
      });
    }

    const itemTotalAmount = items.reduce(
      (sum, item) => sum + item.salePrice * item.quantity,
      0,
    );
    // 自助下单不参与任何优惠：应付恒等于商品合计
    return { items, itemTotalAmount, payableAmount: itemTotalAmount };
  }

  private resolveExistingIdempotency(record: {
    status: string;
    responseSnapshot: Prisma.JsonValue | null;
  }): Record<string, unknown> {
    if (record.status === 'succeeded' && record.responseSnapshot) {
      return record.responseSnapshot as Record<string, unknown>;
    }
    throw new ConflictException('订单正在创建中，请稍后重试');
  }

  private toOrderResponse(order: {
    id: number;
    orderNo: string;
    storeId: number;
    sessionId: number;
    spaceId: number;
    remark: string | null;
    itemTotalAmount: number;
    payableAmount: number;
    status: string;
    paymentStatus: string;
    version: number;
    createdAt: Date;
    items: Array<{
      id: number;
      productId: string;
      productName: string;
      categoryName: string | null;
      salePrice: number;
      quantity: number;
    }>;
  }): Record<string, unknown> {
    return {
      id: order.id,
      orderNo: order.orderNo,
      storeId: order.storeId,
      sessionId: order.sessionId,
      spaceId: order.spaceId,
      remark: order.remark,
      itemTotalAmount: order.itemTotalAmount,
      payableAmount: order.payableAmount,
      status: order.status,
      paymentStatus: order.paymentStatus,
      version: order.version,
      createdAt: order.createdAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName,
        salePrice: item.salePrice,
        quantity: item.quantity,
      })),
    };
  }
}
