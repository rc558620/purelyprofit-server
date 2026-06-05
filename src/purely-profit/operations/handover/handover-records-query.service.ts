import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HandoverStatus, Prisma } from '@prisma/client';
import type {
  HandoverRecordListItemDto,
  HandoverRecordListResponseDto,
  HandoverRecordSummaryListResponseDto,
  HandoverRecordSummaryQueryDto,
} from './dto/handover-records.dto';
import { HandoverRecordsDetailService } from './handover-records-detail.service';
import {
  HANDOVER_RECORD_INCLUDE,
  mapRecordToDto,
  type HandoverRecordRow,
} from './handover.shared';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class HandoverRecordsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly handoverRecordsDetailService: HandoverRecordsDetailService,
  ) {}

  async listHandoverRecords(
    storeId: number,
    limit = 20,
    offset = 0,
  ): Promise<HandoverRecordListResponseDto> {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = Math.max(offset, 0);

    const [records, total] = await Promise.all([
      this.prisma.storeHandoverRecord.findMany({
        where: { storeId },
        include: HANDOVER_RECORD_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.storeHandoverRecord.count({ where: { storeId } }),
    ]);

    return {
      items: records.map((record) => mapRecordToDto(record)),
      total,
    };
  }

  async getHandoverRecord(
    storeId: number,
    recordId: number,
  ): Promise<HandoverRecordListItemDto> {
    const record = await this.findRecordOrThrow(storeId, recordId);
    const detail = await this.handoverRecordsDetailService.buildRecordDetail(
      storeId,
      record,
    );
    return mapRecordToDto(record, detail);
  }

  async listHandoverRecordSummaries(
    storeId: number,
    query: HandoverRecordSummaryQueryDto,
  ): Promise<HandoverRecordSummaryListResponseDto> {
    const filter = this.buildSummaryFilter(query);
    const take = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = Math.max(query.offset ?? 0, 0);
    const where: Prisma.StoreHandoverRecordWhereInput = {
      storeId,
      status: HandoverStatus.completed,
      createdAt: {
        gte: filter.startAt,
        lte: filter.endAt,
      },
    };

    const [records, total] = await Promise.all([
      this.prisma.storeHandoverRecord.findMany({
        where,
        include: HANDOVER_RECORD_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        skip,
      }),
      this.prisma.storeHandoverRecord.count({ where }),
    ]);

    const items = await Promise.all(
      records.map((record) =>
        this.handoverRecordsDetailService.buildRecordSummary(storeId, record),
      ),
    );

    return {
      items,
      total,
    };
  }

  async getMyPendingHandover(
    storeId: number,
    linkedEmployeeId: number | null,
  ): Promise<HandoverRecordListItemDto | null> {
    if (!linkedEmployeeId) {
      return null;
    }

    const record = await this.prisma.storeHandoverRecord.findFirst({
      where: {
        storeId,
        status: HandoverStatus.pending,
        OR: [
          { fromEmployeeId: linkedEmployeeId },
          { toEmployeeId: linkedEmployeeId },
        ],
      },
      include: HANDOVER_RECORD_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return record ? mapRecordToDto(record) : null;
  }

  async findRecordOrThrow(
    storeId: number,
    recordId: number,
  ): Promise<HandoverRecordRow> {
    const record = await this.prisma.storeHandoverRecord.findFirst({
      where: { id: recordId, storeId },
      include: HANDOVER_RECORD_INCLUDE,
    });
    if (!record) {
      throw new NotFoundException('交班记录不存在');
    }
    return record;
  }

  private buildSummaryFilter(query: HandoverRecordSummaryQueryDto): {
    startAt: Date;
    endAt: Date;
  } {
    if (query.date) {
      return this.buildDateFilter(query.date);
    }

    const now = new Date();
    const endAt = this.endOfDay(now);
    const startAt = this.startOfDay(now);
    const preset = query.preset ?? 'today';

    if (preset === '7d') {
      startAt.setDate(startAt.getDate() - 6);
      return { startAt, endAt };
    }

    if (preset === '30d') {
      startAt.setDate(startAt.getDate() - 29);
      return { startAt, endAt };
    }

    return { startAt, endAt };
  }

  private buildDateFilter(dateText: string): { startAt: Date; endAt: Date } {
    const [yearText, monthText, dayText] = dateText.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const startAt = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('日期格式不正确');
    }
    const endAt = new Date(year, month - 1, day, 23, 59, 59, 999);
    return { startAt, endAt };
  }

  private startOfDay(date: Date): Date {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      0,
      0,
      0,
      0,
    );
  }

  private endOfDay(date: Date): Date {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      23,
      59,
      59,
      999,
    );
  }
}
