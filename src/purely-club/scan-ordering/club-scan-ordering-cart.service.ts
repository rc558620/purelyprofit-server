import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { MembershipDowngradeService } from '../../purely-profit/member/platform-membership/membership-downgrade.service';
import { SCAN_ORDER_BLOCKED_MESSAGE } from '../../purely-profit/member/platform-membership/membership-downgrade.messages';
import { computeCartVersion } from './club-scan-ordering-cart-pricing.utils';
import { buildClubCartItemUpsertQuery } from './club-scan-ordering-cart-write.helper';
import type {
  AddClubScanCartItemDto,
  UpdateClubScanCartItemDto,
} from './dto/club-scan-ordering.dto';

/** 购物车行（含规格快照行）查询返回类型。 */
type CartItemWithSpecs = Prisma.ScanOrderingCartItemGetPayload<{
  include: { specs: true };
}>;

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

/**
 * 会话购物车快照。
 *
 * 加购一次要同时用到「该商品已占总量」「各规格选项已占数量」「购物车响应体」
 * 三份数据，而三者的 where 完全一致（sessionId + active + 未删除）。原实现分别用
 * aggregate、专用 findMany、include findMany 各查一次，重复读同一批行；这里合并成
 * 一次读取后在内存聚合，行数本来就要回传前端，不存在额外传输成本。
 */
interface CartSnapshot {
  items: CartItemWithSpecs[];
  /** menuProductId → 该商品在购物车中的活跃行数量合计 */
  productQuantities: Map<number, number>;
  /** specOptionId → 该规格选项在购物车中的已占数量合计 */
  specOptionQuantities: Map<number, number>;
}

@Injectable()
export class ClubScanOrderingCartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly downgradeService: MembershipDowngradeService,
  ) {}

  async getCart(user: AuthenticatedUser, sessionId: number): Promise<unknown> {
    const session = await this.requireSession(user, sessionId);
    const items = await this.loadCartItems(session.id);
    return this.toCartPayload(session.id, items);
  }

  /** 购物车行查询（写操作后复用，避免再走一次 requireSession）。 */
  private loadCartItems(sessionId: number): Promise<CartItemWithSpecs[]> {
    return this.prisma.scanOrderingCartItem.findMany({
      where: { sessionId, status: 'active', deletedAt: null },
      orderBy: { updatedAt: 'asc' },
      include: { specs: true },
    });
  }

  /** 一次读回购物车并聚合出商品级 / 规格级占用数量（替代两条重复查询）。 */
  private async loadCartSnapshot(sessionId: number): Promise<CartSnapshot> {
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
   * 组装购物车响应：加购 / 改量 / 删除是 C 端最高频写操作，写入方已持有会话，
   * 不必再 requireSession 一次来拼响应（每次写操作省 2 次查询）。
   */
  private toCartPayload(
    sessionId: number,
    items: CartItemWithSpecs[],
  ): unknown {
    return {
      sessionId,
      // 行级乐观锁版本之和：只用于粗粒度变更检测，不能当 cartVersion 用
      version: this.cartVersion(items),
      // 与 preview / create 同口径的购物车版本，可直接用于下单校验
      cartVersion: computeCartVersion(items),
      items,
    };
  }

  async quoteCartItem(
    user: AuthenticatedUser,
    dto: Pick<
      AddClubScanCartItemDto,
      'sessionId' | 'productId' | 'specOptionIds'
    >,
  ): Promise<{ unitPriceAmount: number }> {
    const session = await this.requireSession(user, dto.sessionId);
    // 商品快照与购物车规格占用互不依赖（都只需要 session），并行发起省一次往返
    const [product, quotedSpecQuantities] = await Promise.all([
      this.loadProduct(session.storeId, dto.productId),
      // 报价同样要校验规格库存，否则弹窗会给出「可加购」的价格却加不进去
      this.resolveCartSpecOptionQuantities(session.id),
    ]);
    this.assertPurchasable(product, 1);
    const options = this.validateOptions(product.specGroups, dto.specOptionIds);
    for (const option of options) {
      quotedSpecQuantities.set(
        option.id,
        (quotedSpecQuantities.get(option.id) ?? 0) + 1,
      );
    }
    this.assertSpecOptionsPurchasable(options, quotedSpecQuantities);
    return {
      unitPriceAmount:
        product.basePrice +
        options.reduce((sum, option) => sum + option.extraPrice, 0),
    };
  }

  async addCartItem(
    user: AuthenticatedUser,
    dto: AddClubScanCartItemDto,
  ): Promise<unknown> {
    const session = await this.requireSession(user, dto.sessionId);

    // 会员过期门店停止新的下单流程；到期之前已开台的会话允许继续加点
    await this.downgradeService.assertStoreCanOrder(
      session.storeId,
      SCAN_ORDER_BLOCKED_MESSAGE,
      session.createdAt,
    );

    // 商品快照与购物车快照互不依赖（都只需要 session），并行发起省一次往返；
    // 购物车快照一次读回活跃行，同时提供「该商品已占总量」与「规格已占数量」，
    // 替代原先 aggregate + 专用 findMany 两次重复读同一批行。
    const [product, cartSnapshot] = await Promise.all([
      this.loadProduct(session.storeId, dto.productId),
      this.loadCartSnapshot(session.id),
    ]);
    // 同一商品的不同规格会落在多条购物车行，库存必须按「该商品在购物车中的总量」校验，
    // 与下单时的 ClubScanOrderingInventoryReservationService 聚合口径保持一致。
    const cartQuantity = cartSnapshot.productQuantities.get(product.id) ?? 0;
    this.assertPurchasable(product, cartQuantity + dto.quantity);
    const options = this.validateOptions(product.specGroups, dto.specOptionIds);
    // 规格库存必须与商品库存同口径：本次数量 + 购物车中该规格已占数量
    const specQuantities = cartSnapshot.specOptionQuantities;
    for (const option of options) {
      specQuantities.set(
        option.id,
        (specQuantities.get(option.id) ?? 0) + dto.quantity,
      );
    }
    this.assertSpecOptionsPurchasable(options, specQuantities);
    const specSignature = this.hash(
      [...dto.specOptionIds].sort((a, b) => a - b).join(','),
    );
    const unitPriceAmount =
      product.basePrice +
      options.reduce((sum, item) => sum + item.extraPrice, 0);

    // 写入交给数据库原子完成：并发首购同一规格由 ON CONFLICT 排队后走累加分支，
    // 不再依赖捕获 P2002 后重试（详见 writeCartItem 注释）。
    await this.writeCartItem(
      session.id,
      product.id,
      specSignature,
      dto.quantity,
      unitPriceAmount,
      options.map((option) => ({
        specOptionId: option.id,
        extraPriceSnapshot: option.extraPrice,
      })),
    );
    // 会话与购物车行都已在本次写操作中取过，直接组装响应
    return this.toCartPayload(session.id, await this.loadCartItems(session.id));
  }

  /**
   * 购物车行原子写入：同规格已存在则累加，否则新建。
   *
   * 原实现用交互式事务包 `findFirst → create/update → 规格 create`，单次加购要付
   * 5 次往返（BEGIN / SELECT / 写行 / 写规格 / COMMIT），并发首购还要靠捕获 P2002
   * 重试一次才能收敛。现在合并为一条 `INSERT … ON CONFLICT DO UPDATE`（含 CTE 联写
   * 规格行），语句细节、推断谓词约束与列默认值注意事项见 helper 注释。
   */
  private async writeCartItem(
    sessionId: number,
    menuProductId: number,
    specSignature: string,
    quantity: number,
    unitPriceAmount: number,
    specs: Array<{ specOptionId: number; extraPriceSnapshot: number }>,
  ): Promise<void> {
    await this.prisma.$executeRaw(
      buildClubCartItemUpsertQuery({
        sessionId,
        menuProductId,
        specSignature,
        quantity,
        unitPriceAmount,
        specs,
      }),
    );
  }

  async updateCartItem(
    user: AuthenticatedUser,
    itemId: number,
    dto: UpdateClubScanCartItemDto,
  ): Promise<unknown> {
    const item = await this.prisma.scanOrderingCartItem.findFirst({
      where: { id: itemId, status: 'active', deletedAt: null },
      // 只取归属校验与后续步骤需要的会话字段，避免整行会话回表
      include: { session: { select: SESSION_OWNERSHIP_SELECT } },
    });
    if (!item)
      throw new NotFoundException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.RESOURCE_CART_ITEM_NOT_FOUND,
          '购物车商品不存在',
        ),
      );
    this.ensureSessionOwner(user, item.session);
    // 改量同样要校验库存：否则用户把步进器点到大数量也能成功，直到提交订单才被
    // 库存预留打回。口径＝本行新数量 + 该商品其它规格行已占数量。
    // 商品快照与其它购物车行数量互不依赖，并行发起省一次数据库往返。
    const [product, otherLineQuantity] = await Promise.all([
      this.loadProduct(item.session.storeId, item.menuProductId),
      this.resolveCartProductQuantity(
        item.sessionId,
        item.menuProductId,
        item.id,
      ),
    ]);
    this.assertPurchasable(product, otherLineQuantity + dto.quantity);
    const result = await this.prisma.scanOrderingCartItem.updateMany({
      where: { id: itemId, version: dto.version, status: 'active' },
      data: {
        quantity: dto.quantity,
        lineTotalAmount: dto.quantity * item.unitPriceAmount,
        version: { increment: 1 },
      },
    });
    if (result.count === 0)
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_CART_UPDATED,
          '购物车已更新，请刷新后重试',
        ),
      );
    // item.session 已校验过归属与有效期（ensureSessionOwner），无需重查会话
    return this.toCartPayload(
      item.sessionId,
      await this.loadCartItems(item.sessionId),
    );
  }

  async removeCartItem(
    user: AuthenticatedUser,
    itemId: number,
    version: number,
  ): Promise<unknown> {
    const item = await this.prisma.scanOrderingCartItem.findFirst({
      where: { id: itemId, status: 'active', deletedAt: null },
      include: { session: { select: SESSION_OWNERSHIP_SELECT } },
    });
    if (!item)
      throw new NotFoundException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.RESOURCE_CART_ITEM_NOT_FOUND,
          '购物车商品不存在',
        ),
      );
    this.ensureSessionOwner(user, item.session);
    const result = await this.prisma.scanOrderingCartItem.updateMany({
      where: { id: itemId, version, status: 'active' },
      data: {
        status: 'removed',
        deletedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count === 0)
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_CART_UPDATED,
          '购物车已更新，请刷新后重试',
        ),
      );
    // item.session 已校验过归属与有效期（ensureSessionOwner），无需重查会话
    return this.toCartPayload(
      item.sessionId,
      await this.loadCartItems(item.sessionId),
    );
  }

  /** 读取菜单商品（含共享商品库存），不存在或不可售时抛错。 */
  private async loadProduct(storeId: number, productId: number) {
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

  /**
   * 校验该商品在购物车中的目标总量是否可满足。
   *
   * 可用库存口径必须与下单时一致：总库存 − 已预留量（未接单订单占用的预留），
   * 且共享商品（product.stock）停用/删除时同样不可售。
   */
  private assertPurchasable(
    product: {
      stockMode: string;
      stockQuantity: number | null;
      reservedQuantity: number | null;
      product: {
        isActive: boolean;
        deletedAt: Date | null;
        stock: number;
      } | null;
    },
    requiredTotal: number,
  ): void {
    const inventoryProduct = product.product;
    const baseStock = inventoryProduct
      ? inventoryProduct.stock
      : (product.stockQuantity ?? 0);
    const availableStock = baseStock - (product.reservedQuantity ?? 0);
    if (
      product.stockMode === 'sold_out' ||
      (inventoryProduct &&
        (!inventoryProduct.isActive || inventoryProduct.deletedAt)) ||
      (product.stockMode === 'finite' && availableStock < requiredTotal)
    ) {
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.RULE_STOCK_INSUFFICIENT,
          '商品已售罄或库存不足',
        ),
      );
    }
  }

  /** 该商品在购物车中的活跃行数量合计（可排除指定行）。 */
  private async resolveCartProductQuantity(
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

  private async requireSession(
    user: AuthenticatedUser,
    sessionId: number | undefined,
  ) {
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
    if (!session)
      throw new ForbiddenException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_TABLE_SESSION_UNAVAILABLE,
          '当前桌台会话不可用，请重新扫码',
        ),
      );
    return session;
  }

  private ensureSessionOwner(
    user: AuthenticatedUser,
    session: {
      clubUserId: number | null;
      status: string;
      expiresAt: Date;
      deletedAt: Date | null;
    },
  ): void {
    if (
      session.clubUserId !== user.id ||
      session.status !== 'active' ||
      session.expiresAt <= new Date() ||
      session.deletedAt
    )
      throw new ForbiddenException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_TABLE_SESSION_UNAVAILABLE,
          '当前桌台会话不可用，请重新扫码',
        ),
      );
  }

  /**
   * 会话购物车中各规格选项的已占数量（specOptionId → 数量）。
   * 与商品级库存同口径：同一规格可能散落在多行购物车记录里（不同商品共用同一
   * 规格宿主时），必须按选项聚合后再与可用库存比较。
   */
  private async resolveCartSpecOptionQuantities(
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

  /**
   * 规格选项库存校验：stockQuantity 为 null 表示不限，否则
   * 可用库存 = 总库存 − 预留量，必须 >= 目标数量。
   * 与下单时 reserveFiniteSpecStock 的口径保持一致，避免「加进购物车才被告知没货」。
   */
  private assertSpecOptionsPurchasable(
    options: Array<{
      id: number;
      name: string;
      stockQuantity: number | null;
      reservedQuantity: number | null;
    }>,
    requiredByOption: Map<number, number>,
  ): void {
    for (const option of options) {
      if (option.stockQuantity === null) continue;
      const required = requiredByOption.get(option.id) ?? 0;
      const available = option.stockQuantity - (option.reservedQuantity ?? 0);
      if (available < required) {
        throw new ConflictException(
          clubScanOrderingError(
            CLUB_SCAN_ORDERING_ERROR_CODE.RULE_STOCK_INSUFFICIENT,
            `规格【${option.name}】已售罄或库存不足`,
          ),
        );
      }
    }
  }

  private validateOptions(
    groups: Array<{
      id: number;
      minSelections: number;
      maxSelections: number | null;
      options: Array<{
        id: number;
        name: string;
        extraPrice: number;
        stockQuantity: number | null;
        reservedQuantity: number | null;
      }>;
    }>,
    selectedIds: number[],
  ): Array<{
    id: number;
    name: string;
    extraPrice: number;
    stockQuantity: number | null;
    reservedQuantity: number | null;
  }> {
    const selected = new Set(selectedIds);
    const options = groups.flatMap((group) =>
      group.options.filter((option) => selected.has(option.id)),
    );
    if (options.length !== selected.size)
      throw new BadRequestException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.PARAM_SPEC_SELECTION_INVALID,
          '商品规格选择不符合要求',
        ),
      );
    for (const group of groups) {
      // 选中项数量：先建选中集合，再线性统计该组命中的选项数，
      // 避免 options × group.options 的嵌套扫描。
      let count = 0;
      for (const candidate of group.options) {
        if (selected.has(candidate.id)) count += 1;
      }
      if (
        count < group.minSelections ||
        (group.maxSelections !== null && count > group.maxSelections)
      ) {
        throw new BadRequestException(
          clubScanOrderingError(
            CLUB_SCAN_ORDERING_ERROR_CODE.PARAM_SPEC_SELECTION_INVALID,
            '商品规格选择不符合要求',
          ),
        );
      }
    }
    return options;
  }

  private cartVersion(items: Array<{ version: number }>): number {
    return items.reduce((sum, item) => sum + item.version, 0);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
