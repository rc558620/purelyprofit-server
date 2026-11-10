import { Prisma } from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildMarketingPaginationMeta,
  maskPhone,
  resolveMarketingPagination,
} from '../marketing.utils';
import {
  SMS_BROADCAST_DEFAULT_PAGE_SIZE,
  type SmsBroadcastStatusValue,
} from './sms.constants';
import type {
  SmsBroadcastListQueryDto,
  SmsBroadcastRecipientItemDto,
  SmsBroadcastRecipientsQueryDto,
  SmsBroadcastRecipientsResponseDto,
  SmsBroadcastTaskDetailDto,
  SmsBroadcastTaskItemDto,
  SmsBroadcastTaskListResponseDto,
} from './dto/sms.dto';

/** 任务列表查询字段（不含正文，列表页不下拉全文） */
const TASK_LIST_SELECT = {
  broadcastId: true,
  content: true,
  status: true,
  recipientCount: true,
  validMobileCount: true,
  smsSegments: true,
  successCount: true,
  failedCount: true,
  chargedAmountFen: true,
  refundedAmountFen: true,
  createdAt: true,
} as const;

/** 任务列表分页行：_total 由 COUNT(*) OVER() 在同一条 SQL 中带回。 */
interface SmsBroadcastTaskPageRow {
  broadcastId: string;
  content: string;
  status: string;
  recipientCount: number;
  validMobileCount: number;
  smsSegments: number;
  successCount: number;
  failedCount: number;
  chargedAmountFen: number;
  refundedAmountFen: number;
  createdAt: Date;
  _total: number;
}

/** 收件人明细分页行：_total 同上。 */
interface SmsBroadcastRecipientPageRow {
  id: number;
  customerId: number | null;
  phone: string;
  status: string;
  providerCode: string | null;
  providerMessage: string | null;
  _total: number;
}

/**
 * 群发任务查询服务（商家端）。
 *
 * 之前只有「钱包流水」能看到扣了多少钱，**看不到短信到底发出去没有**，
 * 失败的任务对商家完全不可见。这里补上任务列表 / 详情 / 收件人明细，
 * 让「哪些人没收到」可查，也是平台侧人工退费的事实依据。
 */
@Injectable()
export class SmsBroadcastQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listBroadcasts(
    storeId: number,
    query: SmsBroadcastListQueryDto,
  ): Promise<SmsBroadcastTaskListResponseDto> {
    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
      SMS_BROADCAST_DEFAULT_PAGE_SIZE,
    );

    // 分页与总数一次查询：COUNT(*) OVER() 在 LIMIT 之前对全量匹配行计数，
    // 与 findMany + count 语义等价，省一次数据库往返。
    // 范式与 marketing.query.ts 的 queryRechargePage / queryPointsRecordPage 一致。
    const rows = await this.prisma.$queryRaw<SmsBroadcastTaskPageRow[]>`
      SELECT
        t.broadcast_id AS "broadcastId",
        t.content,
        t.status::text AS "status",
        t.recipient_count AS "recipientCount",
        t.valid_mobile_count AS "validMobileCount",
        t.sms_segments AS "smsSegments",
        t.success_count AS "successCount",
        t.failed_count AS "failedCount",
        t.charged_amount_fen AS "chargedAmountFen",
        t.refunded_amount_fen AS "refundedAmountFen",
        t.created_at AS "createdAt",
        COUNT(*) OVER()::int AS _total
      FROM sms_broadcast_tasks t
      WHERE t.store_id = ${storeId}
        ${query.status ? Prisma.sql`AND t.status = ${query.status}::"SmsBroadcastTaskStatus"` : Prisma.empty}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${take} OFFSET ${skip}
    `;

    return {
      items: rows.map((row) => this.toTaskItem(row)),
      meta: buildMarketingPaginationMeta(rows[0]?._total ?? 0, page, take),
    };
  }

  async getBroadcastDetail(
    storeId: number,
    broadcastId: string,
  ): Promise<SmsBroadcastTaskDetailDto> {
    const task = await this.prisma.smsBroadcastTask.findFirst({
      where: { storeId, broadcastId },
      select: TASK_LIST_SELECT,
    });
    if (!task) {
      throw new NotFoundException('群发任务不存在');
    }

    const recipients = await this.listRecipients(storeId, broadcastId, {
      page: 1,
      pageSize: SMS_BROADCAST_DEFAULT_PAGE_SIZE,
    });

    return { task: this.toTaskItem(task), recipients };
  }

  async listRecipients(
    storeId: number,
    broadcastId: string,
    query: SmsBroadcastRecipientsQueryDto,
  ): Promise<SmsBroadcastRecipientsResponseDto> {
    const task = await this.prisma.smsBroadcastTask.findFirst({
      where: { storeId, broadcastId },
      select: { id: true },
    });
    if (!task) {
      throw new NotFoundException('群发任务不存在');
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
      SMS_BROADCAST_DEFAULT_PAGE_SIZE,
    );

    const rows = await this.prisma.$queryRaw<SmsBroadcastRecipientPageRow[]>`
      SELECT
        r.id,
        r.customer_id AS "customerId",
        r.phone,
        r.status::text AS "status",
        r.provider_code AS "providerCode",
        r.provider_message AS "providerMessage",
        COUNT(*) OVER()::int AS _total
      FROM sms_broadcast_recipients r
      WHERE r.task_id = ${task.id}
        ${query.status ? Prisma.sql`AND r.status = ${query.status}::"SmsBroadcastRecipientStatus"` : Prisma.empty}
      ORDER BY r.id ASC
      LIMIT ${take} OFFSET ${skip}
    `;

    return {
      items: rows.map((row) => this.toRecipientItem(row)),
      meta: buildMarketingPaginationMeta(rows[0]?._total ?? 0, page, take),
    };
  }

  private toTaskItem(row: {
    broadcastId: string;
    content: string;
    status: string;
    recipientCount: number;
    validMobileCount: number;
    smsSegments: number;
    successCount: number;
    failedCount: number;
    chargedAmountFen: number;
    refundedAmountFen: number;
    createdAt: Date;
  }): SmsBroadcastTaskItemDto {
    return {
      broadcastId: row.broadcastId,
      content: row.content,
      status: row.status as SmsBroadcastStatusValue,
      recipientCount: row.recipientCount,
      validMobileCount: row.validMobileCount,
      smsSegments: row.smsSegments,
      successCount: row.successCount,
      failedCount: row.failedCount,
      chargedAmountFen: row.chargedAmountFen,
      refundedAmountFen: row.refundedAmountFen,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toRecipientItem(row: {
    id: number;
    customerId: number | null;
    phone: string;
    status: string;
    providerCode: string | null;
    providerMessage: string | null;
  }): SmsBroadcastRecipientItemDto {
    return {
      id: row.id,
      customerId: row.customerId,
      phone: maskPhone(row.phone),
      status: row.status,
      providerCode: row.providerCode,
      providerMessage: row.providerMessage,
    };
  }
}
