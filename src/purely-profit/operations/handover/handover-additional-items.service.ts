import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HandoverStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ConfirmHandoverRequestDto } from './dto/handover-page.dto';
import type {
  CreateHandoverAdditionalItemDto,
  HandoverAdditionalItemDto,
  HandoverAdditionalItemListResponseDto,
  UpdateHandoverAdditionalItemDto,
} from './dto/handover-additional-items.dto';
import {
  AdditionalItemRow,
  HANDOVER_ADDITIONAL_ITEM_NAME_MAX_LENGTH,
  HANDOVER_ADDITIONAL_VALUE_MAX_LENGTH,
  ensureMembershipStoreId,
  mapAdditionalItem,
  normalizeRequiredText,
} from './handover.shared';

@Injectable()
export class HandoverAdditionalItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAdditionalItems(
    user: AuthenticatedUser,
  ): Promise<HandoverAdditionalItemListResponseDto> {
    const storeId = ensureMembershipStoreId(user);
    const items = await this.prisma.storeHandoverAdditionalItem.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const latestValuesByItemId = await this.findLatestValuesByItemId(
      storeId,
      items.map((item) => item.id),
    );

    return {
      items: items.map((item) =>
        mapAdditionalItem({
          ...item,
          val: latestValuesByItemId.get(item.id) ?? '',
        }),
      ),
    };
  }

  async createAdditionalItem(
    user: AuthenticatedUser,
    dto: CreateHandoverAdditionalItemDto,
  ): Promise<HandoverAdditionalItemDto> {
    const storeId = ensureMembershipStoreId(user);
    const name = this.normalizeItemName(dto.name);
    await this.ensureAdditionalItemNameAvailable(storeId, name);

    const created = await this.prisma.storeHandoverAdditionalItem.create({
      data: {
        storeId,
        name,
      },
    });

    return mapAdditionalItem(created);
  }

  async updateAdditionalItem(
    user: AuthenticatedUser,
    itemId: number,
    dto: UpdateHandoverAdditionalItemDto,
  ): Promise<HandoverAdditionalItemDto> {
    const storeId = ensureMembershipStoreId(user);
    const existing = await this.findAdditionalItemOrThrow(storeId, itemId);
    const name = this.normalizeItemName(dto.name);
    await this.ensureAdditionalItemNameAvailable(storeId, name, existing.id);

    const updated = await this.prisma.storeHandoverAdditionalItem.update({
      where: { id: existing.id },
      data: { name },
    });

    return mapAdditionalItem(updated);
  }

  async deleteAdditionalItem(
    user: AuthenticatedUser,
    itemId: number,
  ): Promise<void> {
    const storeId = ensureMembershipStoreId(user);
    await this.findAdditionalItemOrThrow(storeId, itemId);
    await this.prisma.storeHandoverAdditionalItem.delete({
      where: { id: itemId },
    });
  }

  async resolveConfirmAdditionalItems(
    storeId: number,
    additionalItems: ConfirmHandoverRequestDto['additionalItems'],
  ): Promise<Array<{ id: number; value: string }>> {
    if (additionalItems.length === 0) {
      return [];
    }

    const normalizedItems = additionalItems.map((item) => ({
      id: item.id,
      value: normalizeRequiredText(
        item.value,
        HANDOVER_ADDITIONAL_VALUE_MAX_LENGTH,
        '附加项内容不能为空',
      ),
    }));
    const itemIds = Array.from(new Set(normalizedItems.map((item) => item.id)));
    if (itemIds.length !== normalizedItems.length) {
      throw new BadRequestException('附加项不能重复提交');
    }

    const existingItems =
      await this.prisma.storeHandoverAdditionalItem.findMany({
        where: {
          storeId,
          id: { in: itemIds },
        },
        select: { id: true },
      });
    if (existingItems.length !== itemIds.length) {
      throw new BadRequestException('存在无效的附加项');
    }

    return normalizedItems;
  }

  private async findLatestValuesByItemId(
    storeId: number,
    itemIds: number[],
  ): Promise<Map<number, string>> {
    if (itemIds.length === 0) {
      return new Map<number, string>();
    }

    const rows = await this.prisma.storeHandoverAdditionalValue.findMany({
      where: {
        itemId: { in: itemIds },
        item: { storeId },
        record: {
          status: HandoverStatus.completed,
        },
      },
      select: {
        itemId: true,
        value: true,
      },
      orderBy: [
        { record: { handoverAt: 'desc' } },
        { record: { createdAt: 'desc' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });

    const latestValuesByItemId = new Map<number, string>();
    for (const row of rows) {
      if (!latestValuesByItemId.has(row.itemId)) {
        latestValuesByItemId.set(row.itemId, row.value);
      }
    }

    return latestValuesByItemId;
  }

  private async ensureAdditionalItemNameAvailable(
    storeId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const existing = await this.prisma.storeHandoverAdditionalItem.findFirst({
      where: {
        storeId,
        name: {
          equals: name,
          mode: 'insensitive',
        },
        ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('该附加项已存在');
    }
  }

  private async findAdditionalItemOrThrow(
    storeId: number,
    itemId: number,
  ): Promise<AdditionalItemRow> {
    const item = await this.prisma.storeHandoverAdditionalItem.findFirst({
      where: {
        id: itemId,
        storeId,
      },
    });
    if (!item) {
      throw new NotFoundException('交班附加项不存在');
    }
    return item;
  }

  private normalizeItemName(value: string): string {
    return normalizeRequiredText(
      value,
      HANDOVER_ADDITIONAL_ITEM_NAME_MAX_LENGTH,
      '附加项名称不能为空',
    );
  }
}
