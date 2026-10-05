// 客存 C 端写服务：确认/拒绝存入、取件码签发与取消（发起方与确认方必须分离）
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../shared/audit-log.service';
import { CustodyCodeService } from '../../shared/custody/custody-code.service';
import { writeCustodyFreezeLog } from '../../shared/custody/custody-frozen-log';
import type { CustodyStatusValue } from '../../purely-profit/operations/custody/custody.domain';
import { isPickable } from '../../purely-profit/operations/custody/custody.domain';
import {
  CUSTODY_ORDER_NOT_FOUND_MESSAGE,
  CUSTODY_PICKUP_STATUS_INVALID_MESSAGE,
} from '../../purely-profit/operations/custody/custody.constants';
import { ensureCustodyFrozenStockAvailable } from '../../purely-profit/operations/custody/custody-stock.guard';
import { mapClubCustodyOrder } from './club-custody.mapper';
import { ClubCustodyReadService } from './club-custody-read.service';
import { CustodyRealtimeService } from './custody-realtime.service';
import type {
  ClubCustodyAckResponseDto,
  ClubCustodyOrderResponseDto,
  ClubCustodyPickupCodeDto,
} from './dto/club-custody.dto';
import type { ClubCurrentContext } from '../stores/club-stores.types';

@Injectable()
export class ClubCustodyWriteService {
  private readonly logger = new Logger(ClubCustodyWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubCustodyReadService: ClubCustodyReadService,
    private readonly custodyCodeService: CustodyCodeService,
    private readonly auditLogService: AuditLogService,
    private readonly realtimeService: CustodyRealtimeService,
  ) {}

  /**
   * 确认存入：条件流转 draft → stored。
   *
   * 授权口径与 rejectStore 完全一致：存单归属本人 + 仍是草稿，
   * 由 findOwnDraftOrder 的 memberId 条件保证，不依赖任何一次性凭证。
   *
   * 早期版本靠店员口述的 6 位确认码授权，但该码只有 5 分钟有效期，
   * 而待确认存单会一直留在「待确认」列表里——会员面前永远躺着一个必然 400 的动作。
   * 去掉码之后，会员端拿得到 orderId 的路径只有「我的客存 → 待确认」，
   * 归属校验已足以防止他人代确认。
   */
  async confirmStore(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyOrderResponseDto> {
    const memberId = await this.requireMemberId(context);
    const order = await this.findOwnDraftOrder(
      orderId,
      context.store.id,
      memberId,
    );

    const now = new Date();
    /*
     * 冻结口径下必须在此复核可用库存：draft 不占用冻结额度（未确认不算真的存进来），
     * 真正占用发生在这一刻。校验与状态流转放进同一事务并锁住商品行，
     * 否则多张待确认存单各自通过校验、被会员逐个确认后冻结量会超过物理库存。
     */
    await this.prisma.$transaction(async (tx) => {
      if (order.stockMode === 'frozen' && order.productId !== null) {
        await ensureCustodyFrozenStockAvailable(tx, {
          storeId: context.store.id,
          productId: order.productId,
          stockMode: order.stockMode,
          totalQty: order.remainingQty,
        });
      }
      // 条件更新：并发下只有第一次确认能成功
      const updated = await tx.custodyOrder.updateMany({
        where: {
          id: orderId,
          storeId: context.store.id,
          deletedAt: null,
          status: 'draft',
        },
        data: { status: 'stored' },
      });
      if (updated.count === 0) {
        throw new ConflictException('存单状态已变更，请返回列表重新查看');
      }

      /*
       * 冻结台账：确认这一刻才真正占用可用库存（draft 不算占用），
       * 必须在此留痕，否则门店盘点时对不上「为什么这件商品突然不能卖了」。
       */
      if (order.stockMode === 'frozen' && order.productId !== null) {
        await writeCustodyFreezeLog(tx, {
          storeId: context.store.id,
          productId: order.productId,
          productName: order.productName,
          qty: order.remainingQty,
          beforeRemainingQty: 0,
          afterRemainingQty: order.remainingQty,
          operatorStaffId: order.createdByStaffId,
          orderNo: order.orderNo,
          note: `客存存入占用 ${order.remainingQty}${order.unit}（存单 ${order.orderNo}，物理库存未变动）`,
        });
      }
    });

    await this.custodyCodeService.invalidateSummaryCache(context.store.id);
    this.logClubWrite('confirm', context, orderId, {
      orderNo: order.orderNo,
      before: { status: order.status },
      after: { status: 'stored' },
    });
    // B 端存入弹窗据此从「等待中」转「已确认」
    this.realtimeService.publishStoreConfirmed(context.store.id, {
      custodyOrderId: orderId,
      orderNo: order.orderNo,
      confirmedAt: now.toISOString(),
      memberId,
    });

    const latest = await this.prisma.custodyOrder.findFirstOrThrow({
      where: { id: orderId, deletedAt: null },
    });
    return { order: mapClubCustodyOrder(latest, context.store.name, now) };
  }

  /**
   * 拒绝存入：软删草稿，商家端列表不再出现。
   *
   * 拒绝是会员的自保动作、不产生任何权益，凭「存单归属于本人 + 仍是草稿」
   * 即可授权，归属校验由 findOwnDraftOrder 的 memberId 条件保证。
   */
  async rejectStore(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyAckResponseDto> {
    const memberId = await this.requireMemberId(context);
    const order = await this.findOwnDraftOrder(
      orderId,
      context.store.id,
      memberId,
    );

    const rejectedAt = new Date();
    const softDeleted = await this.prisma.custodyOrder.updateMany({
      where: {
        id: orderId,
        storeId: context.store.id,
        deletedAt: null,
        status: 'draft',
      },
      data: { deletedAt: rejectedAt },
    });
    if (softDeleted.count === 0) {
      throw new ConflictException('存单状态已变更，请返回列表重新查看');
    }

    await this.custodyCodeService.invalidateSummaryCache(context.store.id);
    this.logClubWrite('reject', context, orderId, { orderNo: order.orderNo });
    this.realtimeService.publishStoreRejected(context.store.id, {
      custodyOrderId: orderId,
      orderNo: order.orderNo,
      rejectedAt: rejectedAt.toISOString(),
      memberId,
    });

    return { success: true };
  }

  /** 生成取件码：覆盖上一枚未核销的码，60 秒有效 */
  async createPickupCode(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyPickupCodeDto> {
    const memberId = await this.requireMemberId(context);
    const order = await this.prisma.custodyOrder.findFirst({
      where: {
        id: orderId,
        storeId: context.store.id,
        memberId,
        deletedAt: null,
      },
    });
    if (
      !order ||
      !isPickable(
        order.status as CustodyStatusValue,
        order.expireAt,
        new Date(),
      )
    ) {
      throw new BadRequestException(CUSTODY_PICKUP_STATUS_INVALID_MESSAGE);
    }
    if (order.remainingQty <= 0) {
      throw new BadRequestException('存单已取完，无法生成取件码');
    }

    const previous =
      await this.custodyCodeService.readPickupCodeBinding(orderId);
    if (previous) {
      await this.custodyCodeService.cancelPickupCode(previous.code);
    }

    const issued = await this.custodyCodeService.issuePickupCode({
      custodyOrderId: orderId,
      storeId: context.store.id,
    });
    await this.custodyCodeService.bindPickupCode(orderId, issued);
    this.logClubWrite('pickup-code', context, orderId, {
      orderNo: order.orderNo,
      remainingQty: order.remainingQty,
    });
    // B 端核销预览据此感知"客户已出示取件码"，可提前备货
    this.realtimeService.publishPickupCodeCreated(context.store.id, {
      custodyOrderId: orderId,
      orderNo: order.orderNo,
      expiresAt: issued.expiresAt,
    });

    return {
      code: issued.code,
      expiresAt: Date.parse(issued.expiresAt),
      qty: order.remainingQty,
    };
  }

  /** 取消取件码：客户主动作废尚未核销的码（幂等） */
  async cancelPickupCode(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyAckResponseDto> {
    const memberId = await this.requireMemberId(context);
    const order = await this.prisma.custodyOrder.findFirst({
      where: {
        id: orderId,
        storeId: context.store.id,
        memberId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
    }

    const binding =
      await this.custodyCodeService.readPickupCodeBinding(orderId);
    if (binding) {
      await this.custodyCodeService.cancelPickupCode(binding.code);
    }
    await this.custodyCodeService.unbindPickupCode(orderId);
    this.logClubWrite('pickup-cancel', context, orderId, {});

    return { success: true };
  }

  /** 会员身份缺失时的统一处理 */
  private async requireMemberId(context: ClubCurrentContext): Promise<number> {
    const memberId = await this.clubCustodyReadService.findMemberId(context);
    if (memberId === null) {
      throw new NotFoundException(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
    }
    return memberId;
  }

  /** 定位属于本人的草稿存单：确认与拒绝都靠它做归属校验 */
  private async findOwnDraftOrder(
    orderId: number,
    storeId: number,
    memberId: number,
  ) {
    const order = await this.prisma.custodyOrder.findFirst({
      where: {
        id: orderId,
        storeId,
        memberId,
        deletedAt: null,
        status: 'draft',
      },
    });
    if (!order) {
      throw new NotFoundException(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
    }
    return order;
  }

  private logClubWrite(
    action: string,
    context: ClubCurrentContext,
    orderId: number,
    metadata: Record<string, unknown>,
  ): void {
    this.logger.log(
      `[club-custody] ${action} storeId=${context.store.id} orderId=${orderId}`,
    );
    this.auditLogService.record({
      userId: context.user.id,
      action: `club.custody.${action}`,
      resourceType: 'custody_order',
      resourceId: String(orderId),
      metadata,
    });
  }
}
