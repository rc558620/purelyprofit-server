// 客存 B 端写服务：发起存入（草稿 + 推送给客户确认）与作废（含原因审计），幂等与并发控制在此收口
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
import {
  writeCustodyFreezeLog,
  writeCustodyVoidReleaseLog,
} from '../../../shared/custody/custody-frozen-log';
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
import { maskPhone } from '../../marketing/marketing.utils';
import { CustodyRealtimePublisher } from './custody-realtime.publisher';
import { ensureCustodyFrozenStockAvailable } from './custody-stock.guard';
import type {
  CreateCustodyOrderDto,
  VoidCustodyOrderDto,
} from './dto/custody-request.dto';
import type {
  CreateCustodyOrderResponseDto,
  CustodyOrderActionResponseDto,
  VerifyCustodyMemberResponseDto,
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

    // 开关校验先于幂等回放：门店已关闭客存时，重复提交旧幂等键不应重放出一张新单
    const settings = await this.custodyReadService.getSettings(storeId);
    if (!settings.enabled) {
      throw new BadRequestException(CUSTODY_DISABLED_MESSAGE);
    }

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
      return this.replayExistingOrder(storeId, existing, now);
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
      image: dto.image?.trim() ? dto.image.trim() : null,
      idempotencyKey: dto.idempotencyKey ?? null,
    };

    // 冻结口径：寄存量不得超过可用库存（物理库存 − 在存冻结量）。
    // 校验、落库、台账必须在同一事务内：并发建单否则会各自读到同一份可用库存并双双通过校验，
    // 台账也不能与占用动作分离，否则盘点时对不上。
    const order = await this.prisma.$transaction(async (tx) => {
      await ensureCustodyFrozenStockAvailable(tx, input);
      const created = await createCustodyOrderRecord(
        tx,
        input,
        requireMemberConfirm,
      );
      // 未开启会员确认时此刻直接占用额度；draft 要等会员确认才占用，
      // 台账由 C 端 confirmStore 写入，这里不重复计数
      if (
        input.stockMode === 'frozen' &&
        input.productId !== null &&
        created.status === 'stored'
      ) {
        await writeCustodyFreezeLog(tx, {
          storeId,
          productId: input.productId,
          productName: input.productName,
          qty: input.totalQty,
          beforeRemainingQty: 0,
          afterRemainingQty: created.remainingQty,
          operatorStaffId: input.createdByStaffId,
          orderNo: created.orderNo,
          note: `客存存入占用 ${input.totalQty}${input.unit}（存单 ${created.orderNo}，物理库存未变动）`,
        });
      }
      return created;
    });

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
      order: mapCustodyOrder(
        order,
        now,
        await this.custodyReadService.resolveOperatorRole(
          storeId,
          order.createdByStaffId,
        ),
      ),
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
      // 幂等重放：已作废单据直接回档，经手角色仍按原存档店员解析
      return {
        order: mapCustodyOrder(
          order,
          now,
          await this.custodyReadService.resolveOperatorRole(
            storeId,
            order.createdByStaffId,
          ),
        ),
      };
    }
    if (order.status === 'finished') {
      throw new ConflictException('已取完的存单不支持作废');
    }

    const staffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );
    /*
     * 条件更新与解冻台账必须在同一事务：并发下只有真正把状态改成 void 的那一次
     * 才释放冻结额度，各自判断会出现「状态没改成但台账已释放」。
     */
    await this.prisma.$transaction(async (tx) => {
      // 条件更新：并发下只允许一个请求把状态从 draft/stored 改为 void
      const updated = await tx.custodyOrder.updateMany({
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

      /*
       * 作废即释放剩余占用，可用库存回升，必须留痕。
       * draft 单从未占用过额度（冻结只算 stored），不能产生台账，否则两边抵消不平。
       */
      if (
        order.stockMode === 'frozen' &&
        order.productId !== null &&
        order.status === 'stored' &&
        order.remainingQty > 0
      ) {
        await writeCustodyVoidReleaseLog(tx, {
          storeId,
          productId: order.productId,
          productName: order.productName,
          qty: order.remainingQty,
          beforeRemainingQty: order.remainingQty,
          afterRemainingQty: 0,
          operatorStaffId: staffId,
          orderNo: order.orderNo,
          note: `客存作废解冻 ${order.remainingQty}${order.unit}（存单 ${order.orderNo}，物理库存未变动）`,
        });
      }
    });

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

    return {
      order: mapCustodyOrder(
        latest,
        now,
        await this.custodyReadService.resolveOperatorRole(
          storeId,
          latest.createdByStaffId,
        ),
      ),
    };
  }

  /**
   * 重新推送：会员错过上一轮推送（没带手机 / 小程序在后台）时，店员可就地再推一次。
   *
   * 仅 draft 存单可重推；存单本身不产生任何变化，只是把确认请求再送一次到会员端。
   */
  async resendStoreRequest(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<CreateCustodyOrderResponseDto> {
    const storeId = await this.resolveStoreId(user, 'custody:create');
    const now = new Date();
    const order = await this.findOrder(storeId, orderId);

    if (order.status !== 'draft') {
      throw new ConflictException(CUSTODY_RESEND_REQUIRE_DRAFT_MESSAGE);
    }
    if (order.memberId === null) {
      throw new NotFoundException(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
    }

    this.logWrite('重新推送', user.id, storeId, {
      orderId,
      orderNo: order.orderNo,
      memberId: order.memberId,
    });
    await this.realtimePublisher.publishStoreRequested(storeId, order);

    return {
      order: mapCustodyOrder(
        order,
        now,
        await this.custodyReadService.resolveOperatorRole(
          storeId,
          order.createdByStaffId,
        ),
      ),
      requireMemberConfirm: true,
    };
  }

  /** 幂等命中：重放已存在的存单，避免重复建单 */
  private async replayExistingOrder(
    storeId: number,
    order: Prisma.CustodyOrderGetPayload<Record<string, never>>,
    now: Date,
  ): Promise<CreateCustodyOrderResponseDto> {
    return {
      order: mapCustodyOrder(
        order,
        now,
        await this.custodyReadService.resolveOperatorRole(
          storeId,
          order.createdByStaffId,
        ),
      ),
      requireMemberConfirm: order.status === 'draft',
    };
  }

  /** 按手机号校验会员：店员在存入弹窗点「验证会员」时回显昵称与脱敏手机号 */
  async verifyMember(
    user: AuthenticatedUser,
    phone: string,
  ): Promise<VerifyCustodyMemberResponseDto> {
    const storeId = await this.resolveStoreId(user, 'custody:create');
    const member = await this.findMember(storeId, phone);
    return {
      memberId: member.id,
      memberName: member.name || (member.phone ?? ''),
      phoneMasked: maskPhone(member.phone ?? ''),
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
