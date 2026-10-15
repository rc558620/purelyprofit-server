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

    const where = {
      storeId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.smsBroadcastTask.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: TASK_LIST_SELECT,
      }),
      this.prisma.smsBroadcastTask.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toTaskItem(row)),
      meta: buildMarketingPaginationMeta(total, page, take),
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

    const where = {
      taskId: task.id,
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.smsBroadcastRecipient.findMany({
        where,
        orderBy: [{ id: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          customerId: true,
          phone: true,
          status: true,
          providerCode: true,
          providerMessage: true,
        },
      }),
      this.prisma.smsBroadcastRecipient.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toRecipientItem(row)),
      meta: buildMarketingPaginationMeta(total, page, take),
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
