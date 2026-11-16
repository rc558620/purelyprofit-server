import {
  CLUB_CARE_RECORD_ERROR_CODE,
  clubCareRecordError,
} from './club-care-records.errors';
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
  MARKETING_MAX_PAGE_SIZE,
} from '../../purely-profit/marketing/marketing.utils';
import { normalizeTechnicianLabel } from '../../purely-profit/stores/dto/store-response.dto';
import { ClubMemberProfileService } from '../member/member-profile/club-member-profile.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubCareRecordsResponseDto,
  ListClubCareRecordsQueryDto,
} from './dto/club-care-record.dto';
import type { Prisma } from '@prisma/client';
import { resolveCursorLimit } from '../../shared/cursor-pagination.utils';
import {
  buildClubKeysetWhere,
  decodeClubCursor,
  encodeClubCursor,
  type ClubCursorKeySpec,
} from '../shared/club-keyset-cursor.util';

/** 时间线默认每页条数：与前端 CARE_RECORDS_PAGE_SIZE 保持一致 */
const CLUB_CARE_RECORD_DEFAULT_PAGE_SIZE = 10;

/**
 * 护理记录排序键：`visitAt` 是录入即固定的业务时间（补录也写入护理发生时间），
 * 排序位置不随记录编辑变化，可作为稳定游标键。
 */
const CARE_CURSOR_KEYS: ReadonlyArray<ClubCursorKeySpec> = [
  { field: 'visitAt', nullable: false },
];

/** 时间线排序（与 CARE_CURSOR_KEYS 同序：先 visitAt，再由 id 兜底） */
const CARE_ORDER_BY: Prisma.CareRecordOrderByWithRelationInput[] = [
  { visitAt: 'desc' },
  { id: 'desc' },
];

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
   * 游标分页查询会员本人的护理档案（按 visitAt 倒序）。
   *
   * 第 1 页即「最近一次护理」，翻页向更早回溯；效果对比的首尾记录
   * 只在第 1 页随页下发（翻页不会改变首尾，无需重复计算）。
   *
   * `total` 始终是「门店 + 顾客」全量条数（不叠加游标条件），
   * 否则会随翻页递减，与「共 N 次护理」的展示口径冲突。
   */
  async list(
    currentContext: ClubCurrentContext,
    query: ListClubCareRecordsQueryDto = {},
  ): Promise<ClubCareRecordsResponseDto> {
    // 功能档位门禁：仅注册时选择「SPA/养生/美容」模式的门店运行本功能。
    // 其余门店后端一律拒绝，前端亦不展示入口（入口隐藏 + 接口拒绝双保险）。
    if (currentContext.store.memberCareEnabled !== true) {
      throw new ForbiddenException(
        clubCareRecordError(
          CLUB_CARE_RECORD_ERROR_CODE.RULE_CARE_NOT_ENABLED,
          '当前门店未开通护理档案',
        ),
      );
    }

    const pageSize = resolveCursorLimit(query.pageSize, {
      defaultLimit: CLUB_CARE_RECORD_DEFAULT_PAGE_SIZE,
      maxLimit: MARKETING_MAX_PAGE_SIZE,
    });
    const position = decodeClubCursor(query.cursor, CARE_CURSOR_KEYS);
    const customerId = await this.resolveOwnedCustomerId(currentContext);
    // 门店服务人员称呼：C 端把「护理师」列名替换为门店配置（空值 / 旧缓存回落「技师」）
    const technicianLabel = normalizeTechnicianLabel(
      currentContext.store.technicianLabel,
    );
    if (customerId === null) {
      return {
        technicianLabel,
        items: [],
        compareRange: { earliest: null, latest: null },
        nextCursor: null,
        meta: buildMarketingPaginationMeta(0, 1, pageSize),
      };
    }

    const storeId = currentContext.store.id;
    const baseWhere: Prisma.CareRecordWhereInput = { storeId, customerId };
    const where: Prisma.CareRecordWhereInput = position
      ? {
          ...baseWhere,
          ...buildClubKeysetWhere<Prisma.CareRecordWhereInput>(
            CARE_CURSOR_KEYS,
            position,
          ),
        }
      : baseWhere;

    // 多取一行判断是否还有下一页；count 用不含游标的基础条件
    const [rawRows, total] = await Promise.all([
      this.prisma.careRecord.findMany({
        where,
        orderBy: CARE_ORDER_BY,
        take: pageSize + 1,
        select: CARE_RECORD_ROW_SELECT,
      }),
      this.prisma.careRecord.count({ where: baseWhere }),
    ]);

    const rows = rawRows.slice(0, pageSize);
    const [items, compareRange] = await Promise.all([
      mapCareRecordRows(this.prisma, storeId, rows, toClubCareRecordDto),
      position
        ? Promise.resolve(undefined)
        : queryCareRecordCompareRange(
            this.prisma,
            storeId,
            customerId,
            toClubCareRecordDto,
          ),
    ]);

    return {
      technicianLabel,
      items,
      compareRange,
      nextCursor: this.buildNextCursor(rawRows, rows, pageSize),
      meta: buildMarketingPaginationMeta(total, 1, pageSize),
    };
  }

  /** 下一页游标：由本页最后一行编码；末页返回 null */
  private buildNextCursor(
    rawRows: Array<{ id: number; visitAt: Date }>,
    rows: Array<{ id: number; visitAt: Date }>,
    pageSize: number,
  ): string | null {
    if (rawRows.length <= pageSize || rows.length === 0) {
      return null;
    }
    const last = rows[rows.length - 1];
    return encodeClubCursor([last.visitAt], last.id);
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
