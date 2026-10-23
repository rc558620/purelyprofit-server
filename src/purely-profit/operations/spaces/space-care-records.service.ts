import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { StoreBusinessCapabilityService } from '../../stores/store-business-capability.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildCustomerWhere } from '../../marketing/marketing.domain';
import { mapCustomerRow } from '../../marketing/marketing.mapper';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
  type MarketingCustomerStatus,
} from '../../marketing/marketing.utils';
import {
  CARE_RECORD_ROW_SELECT,
  toSpaceCareRecordDto,
} from './space-care-record.mapper';
import {
  mapCareRecordRows,
  queryCareRecordCompareRange,
} from './space-care-record-read.shared';
import type {
  ListSpaceCareCustomersQueryDto,
  ListSpaceCareRecordsQueryDto,
  SpaceCareCustomerListResponseDto,
  SpaceCareCustomerSummaryDto,
  SpaceCareRecordDetailResponseDto,
  SpaceCareRecordDto,
  SpaceCareRecordListResponseDto,
  UpdateSpaceCareRecordDto,
} from './dto/space-care-record.dto';

/** 时间线默认每页条数：与前端 CARE_RECORD_PAGE_SIZE 保持一致 */
const CARE_RECORD_DEFAULT_PAGE_SIZE = 10;

const VIEW_FORBIDDEN_MESSAGE = '无权查看该门店会员护理档案';
const UPDATE_FORBIDDEN_MESSAGE = '无权编辑该门店护理记录';

/** 顾客取数列：与营销域顾客列表完全一致，以便直接复用 mapCustomerRow */
const CARE_CUSTOMER_ROW_SELECT = {
  id: true,
  storeId: true,
  name: true,
  phone: true,
  avatar: true,
  tier: true,
  balance: true,
  points: true,
  totalSpent: true,
  visitCount: true,
  lastVisitAt: true,
  remark: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * 会员护理档案 B 端读服务。
 *
 * 只提供「查列表 / 查详情 / 补录图文」三种能力：护理记录由结账链路自动生成，
 * 接口层刻意不提供新增与删除。
 */
@Injectable()
export class SpaceCareRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly storeBusinessCapabilityService: StoreBusinessCapabilityService,
  ) {}

  /**
   * 会员护理档案档位断言（service 层兜底）。
   *
   * Controller 已挂 `MemberCareGuard`，这里再断言一次是防止未来新增入口
   * 漏挂装饰器导致功能对未开通门店静默开放。
   */
  private async ensureMemberCareEnabled(
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.storeBusinessCapabilityService.ensureMemberCareAccess(user);
  }

  /** 有护理档案的会员列表（查询条件与营销域顾客列表同源） */
  async listCustomers(
    user: AuthenticatedUser,
    query: ListSpaceCareCustomersQueryDto,
  ): Promise<SpaceCareCustomerListResponseDto> {
    await this.ensureMemberCareEnabled(user);

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      VIEW_FORBIDDEN_MESSAGE,
    );
    if (storeId === null) {
      return { items: [], meta: buildMarketingPaginationMeta(0, page, take) };
    }

    const where = buildCustomerWhere({
      storeId,
      status: this.resolveStatusFilter(query.status),
      name: query.name?.trim() || undefined,
      phone: query.phone?.trim() || undefined,
    });

    const [rows, total] = await Promise.all([
      this.prisma.marketingCustomer.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: CARE_CUSTOMER_ROW_SELECT,
      }),
      this.prisma.marketingCustomer.count({ where }),
    ]);

    return {
      items: rows.map(mapCustomerRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  /**
   * 会员护理档案详情：首屏一次请求喂饱对比区 + 时间线第一页。
   *
   * 记录按 visitAt 倒序分页返回（最近一次在前），后续翻页走 listCustomerRecords。
   *
   * 顾客英雄卡（身份 / 账户概览）属于营销域「顾客详情」的能力，这里**不查余额 / 积分 / 消费统计**；
   * 仅在第 1 页多查一条顾客摘要（id / 昵称 / 头像），供详情页标题展示会员姓名。
   * 越权防护下沉到查询条件（storeId + customerId）——跨店顾客天然查不到记录。
   */
  async getCustomerDetail(
    user: AuthenticatedUser,
    customerId: number,
    query: ListSpaceCareRecordsQueryDto = {},
  ): Promise<SpaceCareRecordDetailResponseDto> {
    await this.ensureMemberCareEnabled(user);

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
      CARE_RECORD_DEFAULT_PAGE_SIZE,
    );
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'space:view',
      VIEW_FORBIDDEN_MESSAGE,
    );

    const isFirstPage = page === 1;

    const [records, compareRange, customer] = await Promise.all([
      this.queryCareRecordPage(storeId, customerId, page, skip, take),
      // 首尾只在第 1 页下发，与 C 端 club-care-records 同口径：翻页不改变首尾，
      // 详情接口的翻页路径（listCustomerRecords）本就不带 compareRange，
      // 前端只认首屏那一份（B/C 两端均如此），翻页再查纯属多打两次 findFirst。
      isFirstPage
        ? queryCareRecordCompareRange(
            this.prisma,
            storeId,
            customerId,
            toSpaceCareRecordDto,
          )
        : Promise.resolve(undefined),
      // 店铺名 / 会员名标题只在首屏需要：翻页不再重复查顾客
      isFirstPage
        ? this.queryCustomerSummary(storeId, customerId)
        : Promise.resolve(undefined),
    ]);

    return {
      items: records.items,
      compareRange,
      customer,
      meta: records.meta,
    };
  }

  /** 顾客摘要（id / 昵称 / 头像）：详情页标题所需的最小字段集 */
  private async queryCustomerSummary(
    storeId: number,
    customerId: number,
  ): Promise<SpaceCareCustomerSummaryDto | undefined> {
    const row = await this.prisma.marketingCustomer.findFirst({
      where: { id: customerId, storeId, deletedAt: null },
      select: { id: true, name: true, avatar: true },
    });
    if (row === null) {
      return undefined;
    }

    return {
      id: String(row.id),
      name: row.name ?? '',
      ...(row.avatar ? { avatar: row.avatar } : {}),
    };
  }

  /**
   * 护理记录时间线的翻页查询（真分页，按 visitAt 倒序）。
   *
   * 只按「当前门店 + 顾客 ID」取数：跨店顾客天然查不到记录，
   * 不额外查一次顾客档案，避免每次翻页多打一条 SQL。
   */
  async listCustomerRecords(
    user: AuthenticatedUser,
    customerId: number,
    query: ListSpaceCareRecordsQueryDto = {},
  ): Promise<SpaceCareRecordListResponseDto> {
    await this.ensureMemberCareEnabled(user);

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
      CARE_RECORD_DEFAULT_PAGE_SIZE,
    );
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'space:view',
      VIEW_FORBIDDEN_MESSAGE,
    );

    return this.queryCareRecordPage(storeId, customerId, page, skip, take);
  }

  /** 按门店 + 顾客分页取护理记录，附带历史存量「台位费行」的商品名兜底 */
  private async queryCareRecordPage(
    storeId: number,
    customerId: number,
    page: number,
    skip: number,
    take: number,
  ): Promise<SpaceCareRecordListResponseDto> {
    const where = { storeId, customerId };

    const [rows, total] = await Promise.all([
      this.prisma.careRecord.findMany({
        where,
        orderBy: [{ visitAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: CARE_RECORD_ROW_SELECT,
      }),
      this.prisma.careRecord.count({ where }),
    ]);

    return {
      items: await mapCareRecordRows(
        this.prisma,
        storeId,
        rows,
        toSpaceCareRecordDto,
      ),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  /**
   * 补录护理图文。
   *
   * 只允许改 content / photos：写入字段在 data 里显式列举，
   * 入参的多余字段由全局 ValidationPipe(whitelist) 在入口剥离。
   * 用带 storeId 条件的 updateMany 以影响行数判定归属，天然防跨店越权与并发抢占。
   */
  async updateRecord(
    user: AuthenticatedUser,
    recordId: number,
    dto: UpdateSpaceCareRecordDto,
  ): Promise<SpaceCareRecordDto> {
    await this.ensureMemberCareEnabled(user);

    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'operation-entry:create',
      UPDATE_FORBIDDEN_MESSAGE,
    );

    const result = await this.prisma.careRecord.updateMany({
      where: { id: recordId, storeId },
      data: {
        content: dto.content,
        photos: dto.photos,
        updatedByStaffId: user.currentMembership?.staffId ?? null,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('护理记录不存在或不属于当前门店');
    }

    const row = await this.prisma.careRecord.findUniqueOrThrow({
      where: { id: recordId },
      select: CARE_RECORD_ROW_SELECT,
    });
    const [detail] = await mapCareRecordRows(
      this.prisma,
      storeId,
      [row],
      toSpaceCareRecordDto,
    );
    return detail;
  }

  private resolveStatusFilter(
    status: ListSpaceCareCustomersQueryDto['status'],
  ): MarketingCustomerStatus | undefined {
    return status && status !== 'all' ? status : undefined;
  }
}
