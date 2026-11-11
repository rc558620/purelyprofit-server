// 商家端团购券订单管理服务：当前门店分页列表 / 确认（仅记录不改变状态）/ 拒绝（退款链路 + 广播）
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ClubVoucherOrderRefundService } from '../../../purely-club/voucher-orders/club-voucher-order-refund.service';
import type {
  QueryVoucherOrdersDto,
  VoucherOrderListResponseDto,
} from './dto/voucher-order-management.dto';
import { VoucherOrderStatusFilter } from './dto/voucher-order-management.dto';
import {
  buildTimeRange,
  CONFIRMABLE_STATUS,
  EXPIRE_SCAN_BATCH_SIZE,
  EXPIRE_SCAN_MAX_BATCHES,
  MERCHANT_VISIBLE_STATUSES,
  toConfirmResult,
  toListItem,
  VOUCHER_ORDER_CONFIRM_SELECT,
  VOUCHER_ORDER_MANAGE_LIST_SELECT,
} from './voucher-order-management.helper';
import type {
  VoucherOrderConfirmResult,
  VoucherOrderConfirmRow,
  VoucherOrderRejectResult,
} from './voucher-order-management.helper';

// 结果类型继续从 service 导出，保持 controller 的既有引用不变
export type {
  VoucherOrderConfirmResult,
  VoucherOrderRejectResult,
} from './voucher-order-management.helper';

@Injectable()
export class VoucherOrdersService {
  private readonly logger = new Logger(VoucherOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly refundService: ClubVoucherOrderRefundService,
  ) {}

  /** 当前门店团购券订单分页列表（按 createdAt desc） */
  async listVoucherOrders(
    user: AuthenticatedUser,
    query: QueryVoucherOrdersDto,
  ): Promise<VoucherOrderListResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'space:view',
      '无权查看该门店团购券订单',
    );
    // 惰性过期放在查询之前且覆盖整个门店：只翻当前页会让「已过期」Tab 系统性漏单，
    // 并且 count 与结果集状态口径不一致、下一页 offset 因状态漂移跳过记录。
    await this.expireOverdueStoreOrders(storeId);
    const timeRange = buildTimeRange(query);
    const where: Prisma.ClubVoucherOrderWhereInput = {
      storeId,
      // 未支付草稿单（用户弃付）不进商家端列表：与用户端列表口径一致
      status: { in: [...MERCHANT_VISIBLE_STATUSES] },
      ...(query.status && query.status !== VoucherOrderStatusFilter.ALL
        ? { status: query.status }
        : {}),
      ...(timeRange ? { createdAt: timeRange } : {}),
      // 关键词搜索：匹配订单号、买家姓名、券码（与前端搜索框契约一致）
      ...(query.keyword
        ? {
            OR: [
              { orderNo: { contains: query.keyword, mode: 'insensitive' } },
              { guestName: { contains: query.keyword, mode: 'insensitive' } },
              { voucherCode: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.clubVoucherOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.offset ?? 0,
        take: query.limit ?? 20,
        // 字段裁剪 + 商品图（取营销商品当前图，商品被删后为 null，前端占位展示）
        select: VOUCHER_ORDER_MANAGE_LIST_SELECT,
      }),
      this.prisma.clubVoucherOrder.count({ where }),
    ]);
    return {
      items: rows.map((row) => toListItem(row)),
      total,
    };
  }

  /** 确认订单：仅记录 confirmedAt + confirmedByStaffName，订单状态不变（幂等：已确认直接返回） */
  async confirmVoucherOrder(
    user: AuthenticatedUser,
    orderNo: string,
  ): Promise<VoucherOrderConfirmResult> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'operation-entry:create',
      '无权确认该门店团购券订单',
    );
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo, storeId },
      select: VOUCHER_ORDER_CONFIRM_SELECT,
    });
    if (!order) {
      throw new NotFoundException('团购券订单不存在');
    }
    this.assertPendingStatus(order, '确认');

    // 幂等：已确认过直接返回当前确认信息，不重复写入
    if (order.confirmedAt !== null) {
      return toConfirmResult(order, order.confirmedAt);
    }

    const operatorSnapshot = await this.resolveOperatorSnapshot(user, storeId);
    const confirmedAt = new Date();

    // 带前置状态条件的原子更新：并发双击只有一笔能落库，避免裸 read-modify-write
    const updated = await this.prisma.clubVoucherOrder.updateMany({
      where: { id: order.id, status: 'pending', confirmedAt: null },
      data: {
        confirmedAt,
        confirmedByStaffName: operatorSnapshot.name,
        confirmedByStaffRole: operatorSnapshot.role,
      },
    });
    if (updated.count !== 1) {
      // 被并发抢占：按幂等语义回读最新确认信息，重复提交仍返回成功而非 4xx
      const latest = await this.prisma.clubVoucherOrder.findFirst({
        where: { orderNo, storeId },
        select: VOUCHER_ORDER_CONFIRM_SELECT,
      });
      if (!latest?.confirmedAt) {
        throw new ConflictException('团购券订单确认状态已变更，请刷新后重试');
      }
      return toConfirmResult(latest, latest.confirmedAt);
    }

    this.logger.log(
      `商家确认团购券订单: orderNo=${order.orderNo}, confirmedBy=${operatorSnapshot.name}, 状态保持 pending`,
    );
    // 广播确认事件，供其他商家端打开查看订单页时刷新
    this.realtimeService.publishVoucherOrderConfirmed({
      storeId,
      orderNo: order.orderNo,
      confirmedAt: confirmedAt.toISOString(),
      confirmedByStaffName: operatorSnapshot.name ?? '',
    });

    return {
      orderNo: order.orderNo,
      confirmedAt: confirmedAt.toISOString(),
      confirmedByStaffName: operatorSnapshot.name,
      confirmedByStaffRole: operatorSnapshot.role,
      status: 'pending',
    };
  }

  /** 拒绝订单：仅 pending（已确认也可拒）→ 退款链路 + 记录拒绝信息 + 广播 status_changed(refunded) */
  async rejectVoucherOrder(
    user: AuthenticatedUser,
    orderNo: string,
  ): Promise<VoucherOrderRejectResult> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'operation-entry:create',
      '无权拒绝该门店团购券订单',
    );
    const operatorSnapshot = await this.resolveOperatorSnapshot(user, storeId);
    const rejectedByStaffName = operatorSnapshot.name;

    // 复用退款核心链路：微信原路退回 + 积分返还 + 库存回补 + 写拒绝信息（幂等）
    const result = await this.refundService.rejectVoucherOrderByMerchant({
      storeId,
      orderNo,
      rejectedByStaffName,
      rejectedByStaffRole: operatorSnapshot.role,
    });

    this.logger.log(
      `商家拒绝团购券订单完成: orderNo=${orderNo}, rejectedBy=${rejectedByStaffName}`,
    );
    // 广播退款事件：store 房间（商家端列表刷新）+ voucher-order 房间与 native 订阅者（purelyClub 详情自动变已退款）
    this.realtimeService.publishVoucherOrderStatusChanged({
      storeId,
      orderNo: result.orderNo,
      voucherCode: result.voucherCode,
      status: 'refunded',
      refundAt: result.refundAt,
      rejectedAt: result.rejectedAt,
      rejectedByStaffName,
    });

    return {
      orderNo: result.orderNo,
      status: 'refunded',
      refundAt: result.refundAt,
      rejectedAt: result.rejectedAt,
      rejectedByStaffName,
      rejectedByStaffRole: operatorSnapshot.role,
    };
  }

  /**
   * 解析当前操作员姓名与角色快照（职位判定：门店 owner=主账号 → 子账号店长 → 默认收银员）。
   * 与交班管理 resolveOperatorRole 语义对齐，并额外识别「门店 owner 即主账号」：
   * 部分历史门店 staff.role 可能未同步为 owner，但 store.ownerId 始终是权威主账号依据。
   */
  private async resolveOperatorSnapshot(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<{
    name: string | null;
    role: 'owner' | 'manager' | 'staff' | null;
  }> {
    const staffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );
    if (staffId == null) return { name: null, role: null };

    // 员工行与门店 owner 两处读取互不依赖，并行发出省一次串行往返
    const [staff, store] = await Promise.all([
      this.prisma.staff.findUnique({
        where: { id: staffId },
        select: {
          name: true,
          role: true,
          employeeProfile: {
            select: {
              subAccounts: {
                select: { role: true },
              },
            },
          },
        },
      }),
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: { ownerId: true },
      }),
    ]);
    return {
      name: staff?.name ?? null,
      role: this.resolveOperatorRole(user, store?.ownerId ?? null, staff),
    };
  }

  /** 操作员职位 → 颜色角色：纯判定，不再在判定内部查库 */
  private resolveOperatorRole(
    user: AuthenticatedUser,
    storeOwnerId: number | null,
    staff: {
      role: string;
      employeeProfile: { subAccounts: { role: string } | null } | null;
    } | null,
  ): 'owner' | 'manager' | 'staff' | null {
    // 当前登录用户即门店 owner → 主账号（store.ownerId 是权威主账号依据）
    if (storeOwnerId === user.id) return 'owner';
    // staff 行自身为 owner（老板员工行）→ 主账号
    if (staff?.role === 'owner') return 'owner';
    // 关联激活子账号角色为 manager → 店长
    if (staff?.employeeProfile?.subAccounts?.role === 'manager') {
      return 'manager';
    }
    // 其余（manager/staff/无子账号关联）→ 收银员默认色
    return 'staff';
  }

  private assertPendingStatus(
    order: Pick<VoucherOrderConfirmRow, 'status' | 'expiresAt'>,
    action: '确认' | '拒绝',
  ): void {
    if (
      !CONFIRMABLE_STATUS.includes(
        order.status as (typeof CONFIRMABLE_STATUS)[number],
      )
    ) {
      throw new BadRequestException(`该订单当前状态不可${action}`);
    }
    // 列表惰性翻转尚未跑过时 DB 状态仍是 pending，按有效期兜底拦截已失效券
    if (order.expiresAt !== null && order.expiresAt < new Date()) {
      throw new BadRequestException(`团购券已过有效期，不可${action}`);
    }
  }

  /**
   * 惰性过期（门店维度、分批）：把本门店所有 pending 且已过有效期的订单翻转，
   * 必须在列表查询之前执行，让 where / count / findMany 共用同一份稳定状态。
   *
   * 与旧实现的差异：旧实现每次请求无条件发一条 updateMany，0 命中也产生写事务、
   * WAL 与行锁竞争；这里先按 (store_id,status,expires_at) partial index 探测 id，
   * 无命中直接返回（纯索引范围读），命中才按批翻转并限制单请求批次数，避免门店
   * 长期未访问后首次请求一次性大批量 UPDATE 拉长持锁时间。
   * 条件更新带 status:'pending'，并发重复执行天然幂等。
   */
  private async expireOverdueStoreOrders(storeId: number): Promise<void> {
    const where: Prisma.ClubVoucherOrderWhereInput = {
      storeId,
      status: 'pending',
      expiresAt: { lt: new Date() },
    };
    for (let batch = 0; batch < EXPIRE_SCAN_MAX_BATCHES; batch += 1) {
      const overdue = await this.prisma.clubVoucherOrder.findMany({
        where,
        select: { id: true },
        take: EXPIRE_SCAN_BATCH_SIZE,
      });
      if (overdue.length === 0) return;
      await this.prisma.clubVoucherOrder.updateMany({
        where: {
          id: { in: overdue.map((row) => row.id) },
          status: 'pending',
        },
        data: { status: 'expired' },
      });
      if (overdue.length < EXPIRE_SCAN_BATCH_SIZE) return;
    }
    this.logger.warn(
      `团购券订单惰性过期达到单请求批次上限: storeId=${storeId}, 上限=${EXPIRE_SCAN_BATCH_SIZE * EXPIRE_SCAN_MAX_BATCHES}行，剩余留待下次请求`,
    );
  }
}
