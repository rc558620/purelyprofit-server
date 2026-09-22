// 录入订单表单校验服务：表单联动规则与堂食桌台可用性校验（后端兜底，与前端交互契约一致）

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { CreateManualEntryOrderDto } from './dto/manual-entry.dto';

/**
 * 录入订单表单校验服务。
 *
 * 校验顺序与前端交互契约一致：先校验表单联动规则，再校验堂食桌台可用性。
 */
@Injectable()
export class ManualEntryOrderValidator {
  constructor(private readonly prisma: PrismaService) {}

  /** 建单前置校验：表单联动规则 + 桌台可用性，任一不满足抛业务异常。 */
  async validate(
    storeId: number,
    dto: CreateManualEntryOrderDto,
  ): Promise<void> {
    this.validateFormRules(dto);
    await this.validateDiningTable(storeId, dto);
  }

  /** 表单联动规则校验（后端兜底）。 */
  private validateFormRules(dto: CreateManualEntryOrderDto): void {
    if (dto.diningMode === 'dineIn' && dto.tableId === undefined) {
      throw new BadRequestException('堂食/团购到店必须选择桌台');
    }
    // 第三方外卖：支付方式强制平台结算（前端隐藏支付选择）
    if (dto.diningMode === 'platform' && dto.paymentMethod !== 'platform') {
      throw new BadRequestException('第三方外卖必须使用平台结算');
    }
    // 第三方外卖与平台结算场景必须选择来源渠道
    const requiresSourceChannel =
      dto.diningMode === 'platform' || dto.paymentMethod === 'platform';
    if (requiresSourceChannel && dto.sourceChannel === undefined) {
      throw new BadRequestException('平台结算订单必须选择来源渠道');
    }
    // 券面金额仅平台结算时有效，其余支付方式忽略（防御性校验）
    if (dto.paymentMethod !== 'platform' && dto.voucherAmount !== undefined) {
      throw new BadRequestException('券面金额仅平台结算时可以填写');
    }
  }

  /** 堂食桌台校验：存在、未删除、未停用且属于当前门店。 */
  private async validateDiningTable(
    storeId: number,
    dto: CreateManualEntryOrderDto,
  ): Promise<void> {
    if (dto.tableId === undefined) return;
    const table = await this.prisma.scanOrderingTable.findFirst({
      where: { id: dto.tableId, storeId, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    if (!table) {
      throw new NotFoundException('桌台不存在，请刷新桌台列表');
    }
    if (table.status === 'disabled') {
      throw new ConflictException(`桌台【${table.name}】已停用`);
    }
  }
}
