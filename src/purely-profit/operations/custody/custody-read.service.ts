// 客存 B 端读服务：列表游标分页、详情 + 取出流水、经手人角色与门店配置读取
// 门店统计聚合与缓存口径单独成件（custody-summary.service），避免本文件超长
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustodyCodeService } from '../../../shared/custody/custody-code.service';
import { resolveCustodyStoreSnapshot } from '../../../shared/custody/custody-store-snapshot';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  CUSTODY_ORDER_NOT_FOUND_MESSAGE,
  CUSTODY_PICKUP_RECORD_LIMIT,
} from './custody.constants';
import {
  buildCustodyFilterKey,
  resolveCustodyOperatorRoleFromMembership,
  resolveCustodyOperatorRoleFromStaff,
  type CustodyOperatorRole,
} from './custody.domain';
import {
  mapCustodyOrder,
  mapCustodySettings,
  mapPickupRecord,
} from './custody.mapper';
import { buildCountWhere, buildListQuery, encodeCursor } from './custody.query';
import { CustodySummaryService } from './custody-summary.service';
import type {
  CustodyOrderDetailResponseDto,
  CustodyOrderListResponseDto,
  CustodySettingsDto,
} from './dto/custody-response.dto';
import type { CustodyListParams } from './custody.types';

@Injectable()
export class CustodyReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly custodyCodeService: CustodyCodeService,
    private readonly custodySummaryService: CustodySummaryService,
  ) {}

  /** 列表查询：游标分页 + 总条数 + 门店统计 */
  async listOrders(
    user: AuthenticatedUser,
    params: Omit<CustodyListParams, 'storeId'>,
  ): Promise<CustodyOrderListResponseDto> {
    const storeId = await this.resolveViewStoreId(user);
    const now = new Date();
    const query = buildListQuery({ ...params, storeId }, now);
    const [records, total, summary] = await Promise.all([
      this.prisma.custodyOrder.findMany(query),
      this.resolveTotal(storeId, params, now),
      this.custodySummaryService.getSummary(storeId, now),
    ]);

    const roleById = await this.resolveOperatorRoles(
      storeId,
      records.map((record) => record.createdByStaffId),
    );
    const hasMore = records.length > params.limit;
    const items = records
      .slice(0, params.limit)
      .map((record) =>
        mapCustodyOrder(
          record,
          now,
          this.pickRole(roleById, record.createdByStaffId),
        ),
      );
    const nextCursor =
      hasMore && items.length > 0
        ? encodeCursor(records[params.limit - 1]!)
        : null;

    return { items, nextCursor, total, summary };
  }

  /**
   * 列表总条数：优先读缓存，未命中才落库 count。
   *
   * 总条数只随写操作变化、不随时间漂移，而任何客存写操作都会整键失效，
   * 因此可以安全缓存——列表是最热的读路径，省掉它等于每请求少一次全量 count。
   */
  private async resolveTotal(
    storeId: number,
    params: Omit<CustodyListParams, 'storeId'>,
    now: Date,
  ): Promise<number> {
    const filterKey = buildCustodyFilterKey(params);
    const cached = await this.custodyCodeService.readTotal(storeId, filterKey);
    if (cached !== null) {
      return cached;
    }
    const total = await this.prisma.custodyOrder.count({
      where: buildCountWhere({ ...params, storeId }, now),
    });
    await this.custodyCodeService.writeTotal(storeId, filterKey, total);
    return total;
  }

  /** 详情：存单 + 最近取出流水 */
  async getOrderDetail(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<CustodyOrderDetailResponseDto> {
    const storeId = await this.resolveViewStoreId(user);
    const now = new Date();
    const order = await this.prisma.custodyOrder.findFirst({
      where: { id: orderId, storeId, deletedAt: null },
    });
    if (!order) {
      throw new NotFoundException(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
    }

    const pickupRecords = await this.prisma.custodyPickup.findMany({
      where: { custodyOrderId: order.id, deletedAt: null },
      orderBy: [{ pickedAt: 'desc' }, { id: 'desc' }],
      take: CUSTODY_PICKUP_RECORD_LIMIT,
    });

    const roleById = await this.resolveOperatorRoles(storeId, [
      order.createdByStaffId,
      ...pickupRecords.map((record) => record.operatorStaffId),
    ]);

    return {
      order: mapCustodyOrder(
        order,
        now,
        this.pickRole(roleById, order.createdByStaffId),
      ),
      pickupRecords: pickupRecords.map((record) =>
        mapPickupRecord(
          record,
          this.pickRole(roleById, record.operatorStaffId),
        ),
      ),
    };
  }

  /** 单个店员的角色解析：写 / 核销服务回写响应时复用，避免各处各写一份查询 */
  async resolveOperatorRole(
    storeId: number,
    staffId: number | null,
  ): Promise<CustodyOperatorRole> {
    const roleById = await this.resolveOperatorRoles(storeId, [staffId]);
    return this.pickRole(roleById, staffId);
  }

  /**
   * 当前登录主体作为经手人时的角色：直接从登录态推导，完全不查库。
   *
   * 仅用于「存单经手人就是当前登录者」的路径（如发起存入）；
   * 展示历史经手人的路径必须用 resolveOperatorRole 按员工档案解析。
   * 门店快照走缓存，因此这里通常连门店表都不用读。
   */
  async resolveSelfRole(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<CustodyOperatorRole> {
    const snapshot = await resolveCustodyStoreSnapshot(
      this.prisma,
      this.custodyCodeService,
      storeId,
    );
    return resolveCustodyOperatorRoleFromMembership(
      user.currentMembership,
      user.id,
      snapshot.ownerId,
    );
  }

  /**
   * 批量解析店员角色：一次查询覆盖存单经手与取出流水两个来源的 staffId。
   *
   * 主账号判定以 store.ownerId 为权威依据（历史店员行的 role 可能未同步，
   * 老板的 staff 行可能是 manager），同时带出子账号角色识别店长。
   * 历史单据的店员档案可能已被删除，此时查不到记录，由 pickRole 兜底为操作员。
   */
  private async resolveOperatorRoles(
    storeId: number,
    staffIds: readonly (number | null)[],
  ): Promise<Map<number, CustodyOperatorRole>> {
    const uniqueIds = Array.from(
      new Set(staffIds.filter((id): id is number => id !== null)),
    );
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const [ownerUserId, staffs] = await Promise.all([
      this.resolveStoreOwnerId(storeId),
      this.prisma.staff.findMany({
        where: { id: { in: uniqueIds } },
        select: {
          id: true,
          role: true,
          userId: true,
          employeeProfile: {
            select: { subAccounts: { select: { role: true } } },
          },
        },
      }),
    ]);

    return new Map(
      staffs.map((staff) => [
        staff.id,
        resolveCustodyOperatorRoleFromStaff(
          {
            role: staff.role,
            userId: staff.userId,
            subAccountRole: staff.employeeProfile?.subAccounts?.role ?? null,
          },
          ownerUserId,
        ),
      ]),
    );
  }

  /** 取指定店员的角色：查不到档案（已删除 / 系统行为）时兜底为操作员 */
  private pickRole(
    roleById: Map<number, CustodyOperatorRole>,
    staffId: number | null,
  ): CustodyOperatorRole {
    return (staffId === null ? undefined : roleById.get(staffId)) ?? 'staff';
  }

  /**
   * 门店主账号的登录用户 ID：走门店快照缓存。
   *
   * 主账号判定是权威依据（员工行的 role 可能未同步），但门店行几乎不变，
   * 每个列表 / 详情请求都读一遍纯属浪费。
   */
  private async resolveStoreOwnerId(storeId: number): Promise<number | null> {
    const snapshot = await resolveCustodyStoreSnapshot(
      this.prisma,
      this.custodyCodeService,
      storeId,
    );
    return snapshot.ownerId;
  }

  /**
   * 门店配置读取：优先读缓存，未命中时落库；无记录时返回默认口径，不落库。
   *
   * 配置是写路径（发起存入 / 核销校验 / 确认取出）都要读一遍的门店级数据，
   * 而它只在「门店改配置」时才变，更新接口会主动失效缓存。
   */
  async getSettings(storeId: number): Promise<CustodySettingsDto> {
    const cached =
      await this.custodyCodeService.readSettingsCache<CustodySettingsDto>(
        storeId,
      );
    if (cached) {
      return cached;
    }
    const settings = mapCustodySettings(await this.findSetting(storeId));
    await this.custodyCodeService.writeSettingsCache(storeId, settings);
    return settings;
  }

  /** 门店配置实体读取（写服务复用） */
  findSetting(storeId: number) {
    return this.prisma.custodySetting.findFirst({
      where: { storeId, deletedAt: null },
    });
  }

  private resolveViewStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'custody:view',
      '无权查看当前门店的客存数据',
    );
  }
}
