import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import { computeCartVersion } from './club-scan-ordering-cart-pricing.utils';

/** 购物车行（含规格快照行）查询返回类型。 */
export type CartItemWithSpecs = Prisma.ScanOrderingCartItemGetPayload<{
  include: { specs: true };
}>;

/** 菜单商品 + 库存 + 规格组的读取结果（加购 / 报价 / 改量共用）。 */
export type CartMenuProduct = Prisma.ScanOrderingMenuProductGetPayload<{
  include: {
    product: { select: { isActive: true; deletedAt: true; stock: true } };
    specGroups: { include: { options: true } };
  };
}>;

/** 会话归属与有效期校验所需的最小字段集。 */
export interface SessionOwnership {
  clubUserId: number | null;
  status: string;
  expiresAt: Date;
  deletedAt: Date | null;
  storeId: number;
}

/** 会话购物车快照（一次读回，供商品级 / 规格级库存校验共用）。 */
export interface CartSnapshot {
  items: CartItemWithSpecs[];
  /** menuProductId → 该商品在购物车中的活跃行数量合计 */
  productQuantities: Map<number, number>;
  /** specOptionId → 该规格选项在购物车中的已占数量合计 */
  specOptionQuantities: Map<number, number>;
}

/** 购物车响应体（加购 / 改量 / 删除 / 查询共用同一结构）。 */
export interface ClubCartPayload {
  sessionId: number;
  /** 行级乐观锁版本之和，仅用于粗粒度变更检测 */
  version: number;
  /** 与 preview / create 同口径的购物车版本 */
  cartVersion: number;
  items: CartItemWithSpecs[];
}

/** 改量 / 删除定位到的购物车行：只需归属校验与写操作所需列，不拉回整行会话。 */
export interface CartItemEditorView {
  id: number;
  sessionId: number;
  menuProductId: number;
  unitPriceAmount: number;
  session: SessionOwnership;
}

/**
 * 会话归属校验所需的最小字段集。
 *
 * ensureSessionOwner 只看归属/状态/有效期，改量还要用 storeId 读商品；
 * 用整行 `session: true` 会把桌台关系、扫码上下文等宽列一起拉回来。
 */
const SESSION_OWNERSHIP_SELECT = {
  clubUserId: true,
  status: true,
  expiresAt: true,
  deletedAt: true,
  storeId: true,
} as const;

/**
 * 点餐链路读会话（requireSession）的字段白名单。
 *
 * 归属校验只需上面 5 列，这里再补会话主键与 `createdAt`（会员过期门店的
 * 「已开台会话允许继续加点」判定要用）。桌台关系、`session_token_hash`、
 * 设备信息等列在加购/改量/读购物车路径上没有任何消费方：原先的
 * `include: { table: true }` 会额外回表整行桌台，把每次点餐请求都多付一次
 * 关联查询与更宽的列读取。
 */
const SESSION_READ_SELECT = {
  ...SESSION_OWNERSHIP_SELECT,
  id: true,
  createdAt: true,
} as const;

/** 改量 / 删除的购物车行字段白名单。 */
const CART_ITEM_EDIT_SELECT = {
  id: true,
  sessionId: true,
  menuProductId: true,
  unitPriceAmount: true,
  session: { select: SESSION_OWNERSHIP_SELECT },
} as const;

/**
 * 购物车读取上下文：会话归属校验 + 购物车快照 + 商品快照 + 响应组装。
 *
 * 这些能力此前散落在 ClubScanOrderingCartService 里，与加购/改量/删除的编排逻辑
 * 混在一个文件；拆出后写侧只保留「校验 → 写入 → 回读响应」的编排，读侧改动
 * （字段白名单、聚合口径）不必再触碰写流程。
 */
@Injectable()
export class ClubScanOrderingCartQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** 读取当前用户的有效会话，不可用时抛 403（提示重新扫码）。 */
  async requireSession(
    user: AuthenticatedUser,
    sessionId: number | undefined,
  ): Promise<SessionOwnership & { id: number; createdAt: Date }> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        ...(sessionId ? { id: sessionId } : {}),
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
      select: SESSION_READ_SELECT,
    });
    if (!session) throw sessionUnavailable();
    return session;
  }

  /** 改量 / 删除时复用已取到的会话快照做归属校验，避免再查一次会话。 */
  assertSessionOwner(user: AuthenticatedUser, session: SessionOwnership): void {
    if (
      session.clubUserId !== user.id ||
      session.status !== 'active' ||
      session.expiresAt <= new Date() ||
      session.deletedAt
    )
      throw sessionUnavailable();
  }

  /** 购物车行查询（写操作后复用，避免再走一次 requireSession）。 */
  loadCartItems(sessionId: number): Promise<CartItemWithSpecs[]> {
    return this.prisma.scanOrderingCartItem.findMany({
      where: { sessionId, status: 'active', deletedAt: null },
      orderBy: { updatedAt: 'asc' },
      include: { specs: true },
    });
  }

  /** 一次读回购物车并聚合出商品级 / 规格级占用数量（替代两条重复查询）。 */
  async loadCartSnapshot(sessionId: number): Promise<CartSnapshot> {
    const items = await this.loadCartItems(sessionId);
    const productQuantities = new Map<number, number>();
    const specOptionQuantities = new Map<number, number>();

    for (const item of items) {
      productQuantities.set(
        item.menuProductId,
        (productQuantities.get(item.menuProductId) ?? 0) + item.quantity,
      );
      for (const spec of item.specs) {
        specOptionQuantities.set(
          spec.specOptionId,
          (specOptionQuantities.get(spec.specOptionId) ?? 0) + item.quantity,
        );
      }
    }

    return { items, productQuantities, specOptionQuantities };
  }

  /**
   * 写入后回读购物车并组装响应。
   *
   * 加购 / 改量 / 删除是 C 端最高频写操作，写入方已持有会话与校验结果，
   * 不必再 requireSession 一次来拼响应（每次写操作省 2 次查询）。
   */
  async refreshCartPayload(sessionId: number): Promise<ClubCartPayload> {
    const items = await this.loadCartItems(sessionId);
    return {
      sessionId,
      // 行级乐观锁版本之和：只用于粗粒度变更检测，不能当 cartVersion 用
      version: this.cartVersion(items),
      // 与 preview / create 同口径的购物车版本，可直接用于下单校验
      cartVersion: computeCartVersion(items),
      items,
    };
  }

  /** 定位可写购物车行并校验会话归属；不存在或不可用直接抛错。 */
  async requireCartItemEditor(
    user: AuthenticatedUser,
    cartItemId: number,
  ): Promise<CartItemEditorView> {
    const item = await this.prisma.scanOrderingCartItem.findFirst({
      where: { id: cartItemId, status: 'active', deletedAt: null },
      select: CART_ITEM_EDIT_SELECT,
    });
    if (!item)
      throw new NotFoundException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.RESOURCE_CART_ITEM_NOT_FOUND,
          '购物车商品不存在',
        ),
      );
    this.assertSessionOwner(user, item.session);
    return item;
  }

  /** 读取菜单商品（含共享商品库存），不存在或不可售时抛错。 */
  async loadProduct(
    storeId: number,
    productId: number,
  ): Promise<CartMenuProduct> {
    const product = await this.prisma.scanOrderingMenuProduct.findFirst({
      where: { id: productId, storeId, isActive: true, deletedAt: null },
      include: {
        product: {
          select: { isActive: true, deletedAt: true, stock: true },
        },
        specGroups: {
          where: { isActive: true },
          include: { options: { where: { isActive: true } } },
        },
      },
    });
    if (!product)
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.RULE_STOCK_INSUFFICIENT,
          '商品已售罄或库存不足',
        ),
      );
    return product;
  }

  /** 该商品在购物车中的活跃行数量合计（可排除指定行）。 */
  async resolveProductQuantity(
    sessionId: number,
    menuProductId: number,
    excludeCartItemId?: number,
  ): Promise<number> {
    // 求和下推到数据库：原实现把每一行 quantity 拉回 Node 再 reduce，
    // 加购/改量每次都回传 N 行，现在只回传一个标量。
    const aggregated = await this.prisma.scanOrderingCartItem.aggregate({
      where: {
        sessionId,
        menuProductId,
        status: 'active',
        deletedAt: null,
        ...(excludeCartItemId ? { id: { not: excludeCartItemId } } : {}),
      },
      _sum: { quantity: true },
    });
    return aggregated._sum.quantity ?? 0;
  }

  /**
   * 会话购物车中各规格选项的已占数量（specOptionId → 数量）。
   * 与商品级库存同口径：同一规格可能散落在多行购物车记录里（不同商品共用同一
   * 规格宿主时），必须按选项聚合后再与可用库存比较。
   */
  async resolveSpecOptionQuantities(
    sessionId: number,
  ): Promise<Map<number, number>> {
    const rows = await this.prisma.scanOrderingCartItem.findMany({
      where: { sessionId, status: 'active', deletedAt: null },
      select: {
        quantity: true,
        specs: { select: { specOptionId: true } },
      },
    });
    const quantities = new Map<number, number>();
    for (const row of rows) {
      for (const spec of row.specs) {
        quantities.set(
          spec.specOptionId,
          (quantities.get(spec.specOptionId) ?? 0) + row.quantity,
        );
      }
    }
    return quantities;
  }

  private cartVersion(items: Array<{ version: number }>): number {
    return items.reduce((sum, item) => sum + item.version, 0);
  }
}

const sessionUnavailable = (): ForbiddenException =>
  new ForbiddenException(
    clubScanOrderingError(
      CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_TABLE_SESSION_UNAVAILABLE,
      '当前桌台会话不可用，请重新扫码',
    ),
  );
