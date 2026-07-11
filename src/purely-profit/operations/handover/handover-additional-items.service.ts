import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HandoverStatus, Prisma } from '@prisma/client';
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

    try {
      const created = await this.prisma.storeHandoverAdditionalItem.create({
        data: {
          storeId,
          name,
        },
      });

      return mapAdditionalItem(created);
    } catch (err) {
      // 并发 TOCTOU：应用层校验通过但 DB 唯一约束冲突 P2002
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('该附加项已存在');
      }
      throw err;
    }
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

    try {
      const updated = await this.prisma.storeHandoverAdditionalItem.update({
        where: { id: existing.id },
        data: { name },
      });

      return mapAdditionalItem(updated);
    } catch (err) {
      // 并发 TOCTOU：应用层校验通过但 DB 唯一约束冲突 P2002
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('该附加项已存在');
      }
      throw err;
    }
  }

  async deleteAdditionalItem(
    user: AuthenticatedUser,
    itemId: number,
  ): Promise<void> {
    const storeId = ensureMembershipStoreId(user);
    await this.findAdditionalItemOrThrow(storeId, itemId);

    // 前置检查：是否已被历史交班记录引用（保护数据完整性）
    const referencedCount =
      await this.prisma.storeHandoverAdditionalValue.count({
        where: { itemId },
      });
    if (referencedCount > 0) {
      throw new ConflictException('该附加项已被历史交班记录引用，无法删除');
    }

    try {
      await this.prisma.storeHandoverAdditionalItem.delete({
        where: { id: itemId },
      });
    } catch (err) {
      // 并发删除 / 重复点击：记录已不存在视为幂等成功
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        return;
      }
      throw err;
    }
  }

  async resolveConfirmAdditionalItems(
    storeId: number,
    additionalItems: ConfirmHandoverRequestDto['additionalItems'],
  ): Promise<Array<{ id: number; name: string; value: string }>> {
    if (additionalItems.length === 0) {
      return [];
    }

    const normalizedItems = additionalItems.map((item) => ({
      id: item.id,
      value: (item.value ?? '')
        .trim()
        .slice(0, HANDOVER_ADDITIONAL_VALUE_MAX_LENGTH),
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
        select: { id: true, name: true },
      });
    if (existingItems.length !== itemIds.length) {
      throw new BadRequestException('存在无效的附加项');
    }

    // 构建 id→name 映射，用于写入 itemNameSnapshot
    const nameById = new Map(existingItems.map((item) => [item.id, item.name]));
    return normalizedItems.map((item) => ({
      id: item.id,
      name: nameById.get(item.id) ?? '',
      value: item.value,
    }));
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
