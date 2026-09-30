// 客存 B 端核销服务：取件码校验（签发预留令牌）与确认取出（条件扣减 + 流水 + 库存日志同一事务）
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../shared/audit-log.service';
import { CustodyCodeService } from '../../../shared/custody/custody-code.service';
import { CONFIRM_FAIL_LOCK_SECONDS } from '../../../shared/custody/custody-code.constants';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  CUSTODY_ORDER_NOT_FOUND_MESSAGE,
  CUSTODY_PICKUP_CODE_INVALID_MESSAGE,
  CUSTODY_PICKUP_QTY_INVALID_MESSAGE,
  CUSTODY_PICKUP_STATUS_INVALID_MESSAGE,
  CUSTODY_VERIFY_TOKEN_INVALID_MESSAGE,
} from './custody.constants';
import { isPickable, type CustodyStatusValue } from './custody.domain';
import { mapCustodyOrder, mapVerifyPreview } from './custody.mapper';
import { CustodyPickupVerifyService } from './custody-pickup-verify.service';
import { CustodyRealtimePublisher } from './custody-realtime.publisher';
import type {
  ConfirmPickupDto,
  VerifyPickupCodeDto,
} from './dto/custody-request.dto';
import type {
  CustodyOrderActionResponseDto,
  VerifyPickupCodeResponseDto,
} from './dto/custody-response.dto';

@Injectable()
export class CustodyPickupService {
  private readonly logger = new Logger(CustodyPickupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly custodyCodeService: CustodyCodeService,
    private readonly pickupVerifyService: CustodyPickupVerifyService,
    private readonly auditLogService: AuditLogService,
    private readonly realtimePublisher: CustodyRealtimePublisher,
  ) {}

  /** 校验取件码：签发一次性核销令牌并预览待核销存单（不扣减） */
  async verifyPickupCode(
    user: AuthenticatedUser,
    dto: VerifyPickupCodeDto,
  ): Promise<VerifyPickupCodeResponseDto> {
    const storeId = await this.resolveStoreId(user);
    const staffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    if (
      staffId !== null &&
      (await this.custodyCodeService.isConfirmFailLocked(storeId, staffId))
    ) {
      throw new BadRequestException(
        `核销尝试次数过多，请 ${Math.round(CONFIRM_FAIL_LOCK_SECONDS / 60)} 分钟后重试`,
      );
    }

    const payload = await this.custodyCodeService.consumePickupCode(dto.code);
    if (!payload || payload.storeId !== storeId) {
      await this.registerFailure(storeId, staffId);
      throw new BadRequestException(CUSTODY_PICKUP_CODE_INVALID_MESSAGE);
    }

    const order = await this.prisma.custodyOrder.findFirst({
      where: { id: payload.custodyOrderId, storeId, deletedAt: null },
    });
    if (
      !order ||
      !isPickable(
        order.status as CustodyStatusValue,
        order.expireAt,
        new Date(),
      )
    ) {
      await this.registerFailure(storeId, staffId);
      throw new BadRequestException(CUSTODY_PICKUP_CODE_INVALID_MESSAGE);
    }

    const verifyToken = await this.custodyCodeService.issueVerifyToken(
      dto.code,
      {
        custodyOrderId: order.id,
        storeId,
      },
    );
    await this.clearFailure(storeId, staffId);

    // 高风险场景在确认前就把「是否需要后四位」告诉店员，
    // 避免店员填完数量点确认才被后端打回，白白烧掉一次性令牌
    const phoneVerifyReason =
      await this.pickupVerifyService.resolvePhoneVerifyReason(
        storeId,
        order.productId,
      );

    return {
      preview: mapVerifyPreview(order, verifyToken),
      phoneVerifyRequired: phoneVerifyReason !== null,
      phoneVerifyReason,
    };
  }

  /** 确认取出：原子扣减 + 落取出流水（冻结口径追加库存日志），同一事务内完成 */
  async confirmPickup(
    user: AuthenticatedUser,
    dto: ConfirmPickupDto,
  ): Promise<CustodyOrderActionResponseDto> {
    // P0 防冒领：核对确认必须显式勾选，且先于核销令牌消费，
    // 避免"漏勾选"把一次性令牌烧掉导致店员要重新输码
    this.pickupVerifyService.ensureIdentityChecked(dto.identityChecked);

    const storeId = await this.resolveStoreId(user);
    const tokenPayload = await this.custodyCodeService.consumeVerifyToken(
      dto.verifyToken,
    );
    if (!tokenPayload || tokenPayload.storeId !== storeId) {
      throw new BadRequestException(CUSTODY_VERIFY_TOKEN_INVALID_MESSAGE);
    }

    const duplicated = await this.findIdempotentPickup(
      tokenPayload.custodyOrderId,
      dto.idempotencyKey,
    );
    const now = new Date();
    if (duplicated) {
      const order = await this.findOrder(storeId, tokenPayload.custodyOrderId);
      return { order: mapCustodyOrder(order, now) };
    }

    const order = await this.findOrder(storeId, tokenPayload.custodyOrderId);
    if (!isPickable(order.status as CustodyStatusValue, order.expireAt, now)) {
      throw new ConflictException(CUSTODY_PICKUP_STATUS_INVALID_MESSAGE);
    }
    if (dto.qty <= 0 || dto.qty > order.remainingQty) {
      throw new BadRequestException(CUSTODY_PICKUP_QTY_INVALID_MESSAGE);
    }

    const phoneVerifyReason = await this.pickupVerifyService.verifyPhoneSuffix(
      storeId,
      order.productId,
      order.memberPhoneSnapshot,
      dto.phoneSuffix,
    );

    const staffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );
    const remainingQty = order.remainingQty - dto.qty;

    await this.prisma.$transaction(async (tx) => {
      // 条件扣减：并发核销由数据库行数裁决，禁止裸读改写
      const result = await tx.custodyOrder.updateMany({
        where: {
          id: order.id,
          storeId,
          deletedAt: null,
          status: 'stored',
          remainingQty: { gte: dto.qty },
        },
        data: {
          remainingQty: { decrement: dto.qty },
          ...(remainingQty === 0 ? { status: 'finished' } : {}),
        },
      });
      if (result.count === 0) {
        throw new ConflictException('存单已变更或剩余数量不足，请刷新后重试');
      }

      await tx.custodyPickup.create({
        data: {
          custodyOrderId: order.id,
          storeId,
          qty: dto.qty,
          operatorStaffId: staffId,
          operatorNameSnapshot: user.name,
          relatedOrderId: dto.relatedOrderId ?? null,
          pickedAt: now,
          idempotencyKey: dto.idempotencyKey ?? null,
        },
      });

      if (order.stockMode === 'frozen' && order.productId !== null) {
        await this.writeFrozenReleaseLog(tx, order.productId, storeId, {
          beforeRemainingQty: order.remainingQty,
          afterRemainingQty: remainingQty,
          operatorStaffId: staffId,
          orderNo: order.orderNo,
          productName: order.productName,
          unit: order.unit,
          qty: dto.qty,
          now,
        });
      }
    });

    const latest = await this.findOrder(storeId, order.id);
    await this.custodyCodeService.cancelPickupCode(tokenPayload.pickupCode);
    await this.custodyCodeService.invalidateSummaryCache(storeId);
    this.logger.log(
      `[custody] 取出 storeId=${storeId} orderId=${order.id} qty=${dto.qty} 剩余=${remainingQty}`,
    );
    this.auditLogService.record({
      userId: user.id,
      action: 'custody.pickup',
      resourceType: 'custody_order',
      resourceId: String(order.id),
      metadata: {
        orderNo: order.orderNo,
        before: { remainingQty: order.remainingQty, status: order.status },
        after: { remainingQty, status: latest.status },
        qty: dto.qty,
        // 留痕「店员已核对身份」及触发原因，事后可追责
        identityChecked: dto.identityChecked === true,
        phoneVerifyReason,
      },
    });
    await this.publishPicked(storeId, order, dto.qty, remainingQty, user, now);

    return { order: mapCustodyOrder(latest, now) };
  }

  /** 会员侧实时知情：核销后立刻推送，避免他人冒领而会员毫不知情 */
  private async publishPicked(
    storeId: number,
    order: {
      id: number;
      orderNo: string;
      memberId: number | null;
      productName: string;
      unit: string;
    },
    qty: number,
    remainingQty: number,
    user: AuthenticatedUser,
    now: Date,
  ): Promise<void> {
    await this.realtimePublisher.publishPicked(
      storeId,
      order,
      qty,
      remainingQty,
      user.name ?? '',
      now,
    );
  }

  /**
   * 冻结口径取出日志：物理库存不变，记录可用库存（stock − 在存量）的变化。
   *
   * 可用库存随取出增加 qty，便于门店对账时追溯"为什么这件商品又能卖了"。
   */
  private async writeFrozenReleaseLog(
    tx: Prisma.TransactionClient,
    productId: number,
    storeId: number,
    params: {
      beforeRemainingQty: number;
      afterRemainingQty: number;
      operatorStaffId: number | null;
      orderNo: string;
      productName: string;
      unit: string;
      qty: number;
      now: Date;
    },
  ): Promise<void> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { stock: true },
    });
    if (!product) {
      return;
    }

    await tx.inventoryAdjustmentLog.create({
      data: {
        storeId,
        productId,
        operatorStaffId: params.operatorStaffId,
        productName: params.productName,
        beforeStock: product.stock - params.beforeRemainingQty,
        afterStock: product.stock - params.afterRemainingQty,
        delta: params.qty,
        adjustType: 'custody_pickup',
        note: `客存取出解冻 ${params.qty}${params.unit}（存单 ${params.orderNo}，物理库存未变动）`,
      },
    });
  }

  private async findIdempotentPickup(
    custodyOrderId: number,
    idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      return null;
    }
    return this.prisma.custodyPickup.findFirst({
      where: { custodyOrderId, idempotencyKey, deletedAt: null },
      select: { id: true },
    });
  }

  private async findOrder(storeId: number, orderId: number) {
    const order = await this.prisma.custodyOrder.findFirst({
      where: { id: orderId, storeId, deletedAt: null },
    });
    if (!order) {
      throw new NotFoundException(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
    }
    return order;
  }

  private async registerFailure(
    storeId: number,
    staffId: number | null,
  ): Promise<void> {
    if (staffId !== null) {
      await this.custodyCodeService.registerConfirmFailure(storeId, staffId);
    }
  }

  private async clearFailure(
    storeId: number,
    staffId: number | null,
  ): Promise<void> {
    if (staffId !== null) {
      await this.custodyCodeService.clearConfirmFailures(storeId, staffId);
    }
  }

  private resolveStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'custody:pickup',
      '无权在该门店核销客存',
    );
  }
}
