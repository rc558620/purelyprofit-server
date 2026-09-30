// 客存 B 端写服务：发起存入（草稿 + 确认码）与作废（含原因审计），幂等与并发控制在此收口
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
import type { IssuedShortCode } from '../../../shared/custody/custody-code.types';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  CUSTODY_DISABLED_MESSAGE,
  CUSTODY_MEMBER_NOT_FOUND_MESSAGE,
  CUSTODY_ORDER_NOT_FOUND_MESSAGE,
  CUSTODY_PRODUCT_NOT_FOUND_MESSAGE,
  CUSTODY_RESEND_REQUIRE_DRAFT_MESSAGE,
} from './custody.constants';
import { resolveExpireAt, type CustodyStockModeValue } from './custody.domain';
import { mapCustodyOrder } from './custody.mapper';
import {
  createCustodyOrderRecord,
  findIdempotentOrder,
} from './custody-order-record';
import { CustodyReadService } from './custody-read.service';
import { CustodyRealtimePublisher } from './custody-realtime.publisher';
import { ensureCustodyFrozenStockAvailable } from './custody-stock.guard';
import type {
  CreateCustodyOrderDto,
  VoidCustodyOrderDto,
} from './dto/custody-request.dto';
import type {
  CreateCustodyOrderResponseDto,
  CustodyOrderActionResponseDto,
} from './dto/custody-response.dto';
import type { CustodyCreateInput } from './custody.types';

@Injectable()
export class CustodyWriteService {
  private readonly logger = new Logger(CustodyWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly custodyReadService: CustodyReadService,
    private readonly custodyCodeService: CustodyCodeService,
    private readonly auditLogService: AuditLogService,
    private readonly realtimePublisher: CustodyRealtimePublisher,
  ) {}

  /** 发起存入：建立草稿存单并下发客户确认码（门店关闭确认时直接置为在存） */
  async createOrder(
    user: AuthenticatedUser,
    dto: CreateCustodyOrderDto,
  ): Promise<CreateCustodyOrderResponseDto> {
    const storeId = await this.resolveStoreId(user, 'custody:create');
    const now = new Date();

    const existing = await findIdempotentOrder(
      this.prisma,
      storeId,
      dto.idempotencyKey,
    );
    if (existing) {
      // 诊断：幂等命中直接重放已存在的单，不会再次推送。前端重复提交同一
      // idempotencyKey 时表现为「点了没反应、小程序毫无动静」，此前全链路无痕。
      this.logger.warn(
        `[custody-realtime] 幂等命中，不推送: storeId=${storeId}, orderId=${existing.id}, ` +
          `idempotencyKey=${dto.idempotencyKey ?? '-'}`,
      );
      return this.replayExistingOrder(existing, now);
    }

    const settings = await this.custodyReadService.getSettings(storeId);
    if (!settings.enabled) {
      throw new BadRequestException(CUSTODY_DISABLED_MESSAGE);
    }

    const member = await this.findMember(storeId, dto.memberPhone);
    await this.ensureProductExists(storeId, dto.productId);

    const staffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );
    const requireMemberConfirm = settings.requireMemberConfirm;
    const fallbackName = member.phone ?? '';
    const input: CustodyCreateInput = {
      storeId,
      createdByStaffId: staffId,
      createdByName: user.name,
      member: {
        memberId: member.id,
        memberName: member.name || fallbackName,
        memberPhone: member.phone ?? '',
      },
      productId: dto.productId ?? null,
      productName: dto.productName,
      specName: dto.specName?.trim() ? dto.specName.trim() : null,
      unit: dto.unit,
      totalQty: dto.totalQty,
      location: dto.location?.trim() ? dto.location.trim() : null,
      storedAt: now,
      expireAt: resolveExpireAt(dto.expireAt, settings.defaultExpireDays, now),
      stockMode:
        (dto.stockMode as CustodyStockModeValue | undefined) ??
        settings.stockMode,
      sourceOrderId: dto.sourceOrderId ?? null,
      note: dto.note?.trim() ? dto.note.trim() : null,
      idempotencyKey: dto.idempotencyKey ?? null,
    };

    // 冻结口径：寄存量不得超过可用库存（物理库存 − 在存冻结量）
    await ensureCustodyFrozenStockAvailable(this.prisma, input);

    const order = await createCustodyOrderRecord(
      this.prisma,
      input,
      requireMemberConfirm,
    );
    const confirmCode = requireMemberConfirm
      ? await this.issueConfirmCode(order.id, storeId, member.id)
      : null;

    await this.custodyCodeService.invalidateSummaryCache(storeId);
    this.logWrite('存入', user.id, storeId, {
      orderId: order.id,
      orderNo: order.orderNo,
      memberId: member.id,
      totalQty: input.totalQty,
      unit: input.unit,
      stockMode: input.stockMode,
      requireMemberConfirm,
    });

    // 需客户确认的存单此刻是 draft：实时推给客户小程序弹确认层
    if (requireMemberConfirm) {
      await this.realtimePublisher.publishStoreRequested(storeId, order);
    }

    return {
      order: mapCustodyOrder(order, now),
      confirmCode: confirmCode?.code ?? '',
      confirmCodeExpiresAt: confirmCode?.expiresAt ?? '',
      requireMemberConfirm,
    };
  }

  /** 作废：仅草稿 / 在存（含惰性过期）可作废，必须填写原因 */
  async voidOrder(
    user: AuthenticatedUser,
    orderId: number,
    dto: VoidCustodyOrderDto,
  ): Promise<CustodyOrderActionResponseDto> {
    const storeId = await this.resolveStoreId(user, 'custody:void');
    const now = new Date();
    const order = await this.findOrder(storeId, orderId);

    if (order.status === 'void') {
      return { order: mapCustodyOrder(order, now) };
    }
    if (order.status === 'finished') {
      throw new ConflictException('已取完的存单不支持作废');
    }

    const staffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );
    // 条件更新：并发下只允许一个请求把状态从 draft/stored 改为 void
    const updated = await this.prisma.custodyOrder.updateMany({
      where: {
        id: orderId,
        storeId,
        deletedAt: null,
        status: { in: ['draft', 'stored'] },
      },
      data: {
        status: 'void',
        voidedByStaffId: staffId,
        voidedAt: now,
        voidReason: dto.reason,
      },
    });
    if (updated.count === 0) {
      throw new ConflictException('存单状态已变更，请刷新列表后重试');
    }

    const latest = await this.findOrder(storeId, orderId);
    await this.custodyCodeService.invalidateSummaryCache(storeId);
    this.logWrite('作废', user.id, storeId, {
      orderId,
      orderNo: latest.orderNo,
      before: { status: order.status, remainingQty: order.remainingQty },
      after: { status: latest.status, reason: dto.reason },
    });
    // 会员侧需知情：存单被作废后取件码全部失效
    this.realtimePublisher.publishVoided(storeId, latest, dto.reason, now);

    return { order: mapCustodyOrder(latest, now) };
  }

  /**
   * 重发确认码：确认码 5 分钟过期或客户错过时，店员可就地重发一枚新码。
   *
   * 仅 draft 存单可重发；重发前作废上一枚未确认的码，保证同一时刻只有一枚有效码。
   */
  async resendConfirmCode(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<CreateCustodyOrderResponseDto> {
    const storeId = await this.resolveStoreId(user, 'custody:create');
    const now = new Date();
    const order = await this.findOrder(storeId, orderId);

    if (order.status !== 'draft') {
      throw new ConflictException(CUSTODY_RESEND_REQUIRE_DRAFT_MESSAGE);
    }

    const previous =
      await this.custodyCodeService.readConfirmCodeBinding(orderId);
    if (previous) {
      await this.custodyCodeService.cancelConfirmCode(previous.code);
    }

    const issued = await this.issueConfirmCode(
      order.id,
      storeId,
      order.memberId,
    );
    await this.custodyCodeService.invalidateSummaryCache(storeId);
    this.logWrite('重发确认码', user.id, storeId, {
      orderId,
      orderNo: order.orderNo,
      memberId: order.memberId,
    });

    /*
     * 重发即重新触达：会员错过上一轮推送（没带手机 / 小程序在后台）时，
     * 换一枚新码却不再推一次，B 端弹窗会一直停在「等待中」直到超时。
     * 这里补发 store_requested，让「重新推送」按钮真正把确认层弹到会员面前。
     */
    if (order.memberId !== null) {
      await this.realtimePublisher.publishStoreRequested(storeId, order);
    }

    return {
      order: mapCustodyOrder(order, now),
      confirmCode: issued.code,
      confirmCodeExpiresAt: issued.expiresAt,
      requireMemberConfirm: true,
    };
  }

  private async issueConfirmCode(
    orderId: number,
    storeId: number,
    memberId: number | null,
  ): Promise<IssuedShortCode> {
    const issued = await this.custodyCodeService.issueConfirmCode({
      custodyOrderId: orderId,
      storeId,
      memberId,
    });
    await this.custodyCodeService.bindConfirmCode(orderId, issued);
    return issued;
  }

  /** 幂等命中：回填同一枚未过期确认码，避免重复建单 */
  private async replayExistingOrder(
    order: Prisma.CustodyOrderGetPayload<Record<string, never>>,
    now: Date,
  ): Promise<CreateCustodyOrderResponseDto> {
    const binding = await this.custodyCodeService.readConfirmCodeBinding(
      order.id,
    );
    return {
      order: mapCustodyOrder(order, now),
      confirmCode: binding?.code ?? '',
      confirmCodeExpiresAt: binding?.expiresAt ?? '',
      requireMemberConfirm: order.status === 'draft',
    };
  }

  private async findMember(storeId: number, phone: string) {
    const member = await this.prisma.member.findFirst({
      where: { storeId, phone, deletedAt: null, status: { not: 'banned' } },
      select: { id: true, name: true, phone: true },
    });
    if (!member) {
      throw new NotFoundException(CUSTODY_MEMBER_NOT_FOUND_MESSAGE);
    }
    return member;
  }

  private async ensureProductExists(
    storeId: number,
    productId: number | undefined,
  ): Promise<void> {
    if (productId === undefined) {
      return;
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, storeId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(CUSTODY_PRODUCT_NOT_FOUND_MESSAGE);
    }
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

  private async resolveStoreId(
    user: AuthenticatedUser,
    permission: 'custody:create' | 'custody:void',
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      permission,
      '无权在当前门店操作客存',
    );
  }

  /** 写操作统一留痕（结构化日志 + 审计库），脱敏信息不入日志 */
  private logWrite(
    action: string,
    userId: number,
    storeId: number,
    metadata: Record<string, unknown>,
  ): void {
    this.logger.log(`[custody] ${action} storeId=${storeId} userId=${userId}`);
    this.auditLogService.record({
      userId,
      action: `custody.${action}`,
      resourceType: 'custody_order',
      metadata,
    });
  }
}
