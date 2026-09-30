// 客存 C 端写服务：输码预览、确认/拒绝存入、取件码签发与取消（发起方与确认方必须分离）
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
import { CONFIRM_FAIL_LOCK_SECONDS } from '../../shared/custody/custody-code.constants';
import type { CustodyStatusValue } from '../../purely-profit/operations/custody/custody.domain';
import { isPickable } from '../../purely-profit/operations/custody/custody.domain';
import {
  CUSTODY_CONFIRM_CODE_INVALID_MESSAGE,
  CUSTODY_CONFIRM_CODE_LOCKED_CLUB_MESSAGE,
  CUSTODY_ORDER_NOT_FOUND_MESSAGE,
  CUSTODY_PICKUP_STATUS_INVALID_MESSAGE,
} from '../../purely-profit/operations/custody/custody.constants';
import { mapClubCustodyOrder, mapClubPreview } from './club-custody.mapper';
import { ClubCustodyReadService } from './club-custody-read.service';
import { CustodyRealtimeService } from './custody-realtime.service';
import type {
  ClubCustodyAckResponseDto,
  ClubCustodyOrderResponseDto,
  ClubCustodyPickupCodeDto,
  ClubCustodyPreviewResponseDto,
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

  /** 按 6 位确认码预览待确认存单（不消费码，可反复预览） */
  async previewByCode(
    context: ClubCurrentContext,
    code: string,
  ): Promise<ClubCustodyPreviewResponseDto> {
    const memberId = await this.requireMemberId(context);

    // 防暴力枚举：窗口内连续输错达到阈值即拒绝继续预览
    if (
      await this.custodyCodeService.isClubConfirmFailLocked(
        context.store.id,
        memberId,
      )
    ) {
      throw new BadRequestException(
        `${CUSTODY_CONFIRM_CODE_LOCKED_CLUB_MESSAGE}（${Math.round(CONFIRM_FAIL_LOCK_SECONDS / 60)} 分钟）`,
      );
    }

    const payload = await this.custodyCodeService.peekConfirmCode(code);
    if (
      !payload ||
      payload.storeId !== context.store.id ||
      payload.memberId !== memberId
    ) {
      await this.custodyCodeService.registerClubConfirmFailure(
        context.store.id,
        memberId,
      );
      throw new NotFoundException(CUSTODY_CONFIRM_CODE_INVALID_MESSAGE);
    }

    const order = await this.findDraftOrder(
      payload.custodyOrderId,
      context.store.id,
    );
    await this.custodyCodeService.clearClubConfirmFailures(
      context.store.id,
      memberId,
    );
    return { preview: mapClubPreview(order, context.store.name) };
  }

  /** 确认存入：消费确认码 + 条件流转 draft → stored */
  async confirmStore(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyOrderResponseDto> {
    const payload = await this.consumeOwnConfirmCode(context, orderId);
    // 安全约束：确认人必须是码所绑定的本店会员本人。
    // 一期强制会员制，匿名码（memberId 为 null）一律拒绝，
    // 不可写成「memberId 非空才校验」——那等于谁都能确认。
    const memberId = await this.requireMemberId(context);
    if (payload.memberId === null || payload.memberId !== memberId) {
      throw new BadRequestException(CUSTODY_CONFIRM_CODE_INVALID_MESSAGE);
    }

    const now = new Date();
    const order = await this.findDraftOrder(orderId, context.store.id);
    // 条件更新：并发下只有第一次确认能成功
    const updated = await this.prisma.custodyOrder.updateMany({
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

    await this.custodyCodeService.unbindConfirmCode(orderId);
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

  /** 拒绝存入：消费确认码并软删草稿，商家端列表不再出现 */
  async rejectStore(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyAckResponseDto> {
    const payload = await this.consumeOwnConfirmCode(context, orderId);
    // 与 confirmStore 同一条安全约束：匿名码与冒名确认一律拒绝
    const memberId = await this.requireMemberId(context);
    if (payload.memberId === null || payload.memberId !== memberId) {
      throw new BadRequestException(CUSTODY_CONFIRM_CODE_INVALID_MESSAGE);
    }

    const rejectedAt = new Date();
    const order = await this.findDraftOrder(orderId, context.store.id);
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

    await this.custodyCodeService.unbindConfirmCode(orderId);
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

  private async findDraftOrder(orderId: number, storeId: number) {
    const order = await this.prisma.custodyOrder.findFirst({
      where: { id: orderId, storeId, deletedAt: null, status: 'draft' },
    });
    if (!order) {
      throw new NotFoundException(CUSTODY_CONFIRM_CODE_INVALID_MESSAGE);
    }
    return order;
  }

  /** 消费属于当前门店的确认码（定位不到即视为无效或已过期） */
  private async consumeOwnConfirmCode(
    context: ClubCurrentContext,
    orderId: number,
  ) {
    const binding =
      await this.custodyCodeService.readConfirmCodeBinding(orderId);
    if (!binding) {
      throw new BadRequestException(CUSTODY_CONFIRM_CODE_INVALID_MESSAGE);
    }
    const payload = await this.custodyCodeService.consumeConfirmCode(
      binding.code,
    );
    if (!payload || payload.storeId !== context.store.id) {
      throw new BadRequestException(CUSTODY_CONFIRM_CODE_INVALID_MESSAGE);
    }
    return payload;
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
