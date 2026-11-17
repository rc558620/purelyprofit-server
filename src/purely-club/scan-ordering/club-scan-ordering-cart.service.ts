import { ConflictException, Injectable } from '@nestjs/common';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { MembershipDowngradeService } from '../../purely-profit/member/platform-membership/membership-downgrade.service';
import { SCAN_ORDER_BLOCKED_MESSAGE } from '../../purely-profit/member/platform-membership/membership-downgrade.messages';
import { requireSellableProduct } from './club-scan-ordering-cart-pricing.utils';
import type { ClubCartItemUpsertParams } from './club-scan-ordering-cart-write.helper';
import { buildClubCartItemUpsertQuery } from './club-scan-ordering-cart-write.helper';
import {
  ClubScanOrderingCartQueryService,
  type ClubCartPayload,
} from './club-scan-ordering-cart-query.service';
import {
  accumulateSpecOptionQuantity,
  assertSpecOptionsPurchasable,
  computeUnitPriceAmount,
  hashSpecSignature,
  validateSpecOptions,
} from './club-scan-ordering-cart-spec.utils';
import type {
  AddClubScanCartItemDto,
  UpdateClubScanCartItemDto,
} from './dto/club-scan-ordering.dto';

/**
 * 扫码点餐购物车写侧编排。
 *
 * 读会话 / 读商品 / 读购物车快照 / 会话归属校验、规格选择与库存校验已分别下沉到
 * ClubScanOrderingCartQueryService 与 club-scan-ordering-cart-spec.utils；
 * 本文件只保留「校验顺序 + 原子写入 + 回读响应」三段式编排。
 */
@Injectable()
export class ClubScanOrderingCartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly downgradeService: MembershipDowngradeService,
    private readonly cartQuery: ClubScanOrderingCartQueryService,
  ) {}

  async getCart(
    user: AuthenticatedUser,
    sessionId: number,
  ): Promise<ClubCartPayload> {
    const session = await this.cartQuery.requireSession(user, sessionId);
    return this.cartQuery.refreshCartPayload(session.id);
  }

  async quoteCartItem(
    user: AuthenticatedUser,
    dto: Pick<
      AddClubScanCartItemDto,
      'sessionId' | 'productId' | 'specOptionIds'
    >,
  ): Promise<{ unitPriceAmount: number }> {
    const session = await this.cartQuery.requireSession(user, dto.sessionId);
    // 商品快照与购物车规格占用互不依赖（都只需要 session），并行发起省一次往返
    const [product, quotedSpecQuantities] = await Promise.all([
      this.cartQuery.loadProduct(session.storeId, dto.productId),
      // 报价同样要校验规格库存，否则弹窗会给出「可加购」的价格却加不进去
      this.cartQuery.resolveSpecOptionQuantities(session.id),
    ]);
    requireSellableProduct(product, 1);
    const options = validateSpecOptions(product.specGroups, dto.specOptionIds);
    accumulateSpecOptionQuantity(quotedSpecQuantities, options, 1);
    assertSpecOptionsPurchasable(options, quotedSpecQuantities);
    return {
      unitPriceAmount: computeUnitPriceAmount(product.basePrice, options),
    };
  }

  async addCartItem(
    user: AuthenticatedUser,
    dto: AddClubScanCartItemDto,
  ): Promise<ClubCartPayload> {
    const session = await this.cartQuery.requireSession(user, dto.sessionId);

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
      this.cartQuery.loadProduct(session.storeId, dto.productId),
      this.cartQuery.loadCartSnapshot(session.id),
    ]);
    // 同一商品的不同规格会落在多条购物车行，库存必须按「该商品在购物车中的总量」校验，
    // 与下单时的 ClubScanOrderingInventoryReservationService 聚合口径保持一致。
    const cartQuantity = cartSnapshot.productQuantities.get(product.id) ?? 0;
    requireSellableProduct(product, cartQuantity + dto.quantity);
    const options = validateSpecOptions(product.specGroups, dto.specOptionIds);
    // 规格库存必须与商品库存同口径：本次数量 + 购物车中该规格已占数量
    const specQuantities = cartSnapshot.specOptionQuantities;
    accumulateSpecOptionQuantity(specQuantities, options, dto.quantity);
    assertSpecOptionsPurchasable(options, specQuantities);

    // 写入交给数据库原子完成：并发首购同一规格由 ON CONFLICT 排队后走累加分支，
    // 不再依赖捕获 P2002 后重试（详见 writeCartItem 注释）。
    await this.writeCartItem({
      sessionId: session.id,
      menuProductId: product.id,
      specSignature: hashSpecSignature(dto.specOptionIds),
      quantity: dto.quantity,
      unitPriceAmount: computeUnitPriceAmount(product.basePrice, options),
      specs: options.map((option) => ({
        specOptionId: option.id,
        extraPriceSnapshot: option.extraPrice,
      })),
    });
    // 会话与购物车行都已在本次写操作中取过，直接组装响应
    return this.cartQuery.refreshCartPayload(session.id);
  }

  async updateCartItem(
    user: AuthenticatedUser,
    itemId: number,
    dto: UpdateClubScanCartItemDto,
  ): Promise<ClubCartPayload> {
    // 购物车行 + 会话归属一次取回并校验，后续步骤不再重查会话
    const item = await this.cartQuery.requireCartItemEditor(user, itemId);
    // 改量同样要校验库存：否则用户把步进器点到大数量也能成功，直到提交订单才被
    // 库存预留打回。口径＝本行新数量 + 该商品其它规格行已占数量。
    // 商品快照与其它购物车行数量互不依赖，并行发起省一次数据库往返。
    const [product, otherLineQuantity] = await Promise.all([
      this.cartQuery.loadProduct(item.session.storeId, item.menuProductId),
      this.cartQuery.resolveProductQuantity(
        item.sessionId,
        item.menuProductId,
        item.id,
      ),
    ]);
    requireSellableProduct(product, otherLineQuantity + dto.quantity);

    // 乐观锁 CAS：带 version 条件更新，影响行数为 0 说明已被并发改过
    const result = await this.prisma.scanOrderingCartItem.updateMany({
      where: { id: itemId, version: dto.version, status: 'active' },
      data: {
        quantity: dto.quantity,
        lineTotalAmount: dto.quantity * item.unitPriceAmount,
        version: { increment: 1 },
      },
    });
    this.assertVersionApplied(result.count);
    return this.cartQuery.refreshCartPayload(item.sessionId);
  }

  async removeCartItem(
    user: AuthenticatedUser,
    itemId: number,
    version: number,
  ): Promise<ClubCartPayload> {
    const item = await this.cartQuery.requireCartItemEditor(user, itemId);
    const result = await this.prisma.scanOrderingCartItem.updateMany({
      where: { id: itemId, version, status: 'active' },
      data: {
        status: 'removed',
        deletedAt: new Date(),
        version: { increment: 1 },
      },
    });
    this.assertVersionApplied(result.count);
    return this.cartQuery.refreshCartPayload(item.sessionId);
  }

  /**
   * 购物车行原子写入：同规格已存在则累加，否则新建。
   *
   * 原实现用交互式事务包 `findFirst → create/update → 规格 create`，单次加购要付
   * 5 次往返（BEGIN / SELECT / 写行 / 写规格 / COMMIT），并发首购还要靠捕获 P2002
   * 重试一次才能收敛。现在合并为一条 `INSERT … ON CONFLICT DO UPDATE`（含 CTE 联写
   * 规格行），语句细节、推断谓词约束与列默认值注意事项见 helper 注释。
   */
  private async writeCartItem(params: ClubCartItemUpsertParams): Promise<void> {
    await this.prisma.$executeRaw(buildClubCartItemUpsertQuery(params));
  }

  /** 乐观锁更新结果校验：影响行数为 0 表示版本已过期（并发改量 / 删除）。 */
  private assertVersionApplied(affectedRows: number): void {
    if (affectedRows === 0)
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_CART_UPDATED,
          '购物车已更新，请刷新后重试',
        ),
      );
  }
}
