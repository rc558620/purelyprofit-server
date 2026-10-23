import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CARE_RECORD_ROW_SELECT,
  toClubCareRecordDto,
} from '../../purely-profit/operations/spaces/space-care-record.mapper';
import {
  mapCareRecordRows,
  queryCareRecordCompareRange,
} from '../../purely-profit/operations/spaces/space-care-record-read.shared';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
} from '../../purely-profit/marketing/marketing.utils';
import { ClubMemberProfileService } from '../member/member-profile/club-member-profile.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubCareRecordsResponseDto,
  ListClubCareRecordsQueryDto,
} from './dto/club-care-record.dto';

/** 时间线默认每页条数：与前端 CARE_RECORDS_PAGE_SIZE 保持一致 */
const CLUB_CARE_RECORD_DEFAULT_PAGE_SIZE = 10;

/**
 * 会员护理档案 C 端只读服务。
 *
 * 身份认领**必须**走 ClubMemberProfileService.getSnapshotByStoreIdentity 的
 * 两层锚定：`(storeId, clubUserId)` 权威锚点 → 锚点落空才按手机号认领
 * **无主**（clubUserId 为 null）档案。禁止直接按 phone 认领，
 * 否则同门店存在两条同号档案时会拿到别人的护理记录。
 */
@Injectable()
export class ClubCareRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubMemberProfileService: ClubMemberProfileService,
  ) {}

  /**
   * 分页查询会员本人的护理档案（真分页，按 visitAt 倒序）。
   *
   * 第 1 页即「最近一次护理」，翻页向更早回溯；效果对比的首尾记录
   * 只在第 1 页随页下发（翻页不会改变首尾，无需重复计算）。
   */
  async list(
    currentContext: ClubCurrentContext,
    query: ListClubCareRecordsQueryDto = {},
  ): Promise<ClubCareRecordsResponseDto> {
    // 功能档位门禁：仅注册时选择「SPA/养生/美容」模式的门店运行本功能。
    // 其余门店后端一律拒绝，前端亦不展示入口（入口隐藏 + 接口拒绝双保险）。
    if (currentContext.store.memberCareEnabled !== true) {
      throw new ForbiddenException('当前门店未开通护理档案');
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
      CLUB_CARE_RECORD_DEFAULT_PAGE_SIZE,
    );
    const customerId = await this.resolveOwnedCustomerId(currentContext);
    if (customerId === null) {
      return {
        items: [],
        compareRange: { earliest: null, latest: null },
        meta: buildMarketingPaginationMeta(0, page, take),
      };
    }

    const storeId = currentContext.store.id;
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

    const [items, compareRange] = await Promise.all([
      mapCareRecordRows(this.prisma, storeId, rows, toClubCareRecordDto),
      page === 1
        ? queryCareRecordCompareRange(
            this.prisma,
            storeId,
            customerId,
            toClubCareRecordDto,
          )
        : Promise.resolve(undefined),
    ]);

    return {
      items,
      compareRange,
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  /**
   * 定位当前登录者本人在本店的顾客档案 ID；非本店会员 / 无顾客档案时返回 null。
   *
   * 快照来自 15s 缓存；`customerId` 是本次新增字段，发布瞬间可能读到
   * 不含该字段的旧快照，故用 `?? null` 兜底（最坏情况是首次访问为空，刷新即恢复）。
   */
  private async resolveOwnedCustomerId(
    currentContext: ClubCurrentContext,
  ): Promise<number | null> {
    const snapshot =
      await this.clubMemberProfileService.getSnapshotByStoreIdentity(
        currentContext.store.id,
        currentContext.user.id,
        currentContext.user.phone,
      );
    return snapshot?.customerId ?? null;
  }
}
