import { Injectable } from '@nestjs/common';
import { Money } from '../../../shared/money.utils';
import type {
  CreateSalesRecordDto,
  PreviewSalesRecordItemDto,
  PreviewSalesRecordResponseDto,
} from './dto/sales-record.dto';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';
import type { PreparedSalesItem } from './sales-record-item-preparation.service';

/**
 * 销售记录预览服务 — 不落库，仅根据前端提交的 items 算出权威金额。
 * 前端在用户确认提交前调用 preview，拿到后端计算结果后直接展示，
 * 不再在前端做任何业务金额计算。
 *
 * 【重要】此服务必须使用 SalesRecordAmountsDomain 统一聚合金额，
 * 确保 preview 与 create 的计算完全一致。
 */
@Injectable()
export class SalesRecordPreviewService {
  preview(dto: CreateSalesRecordDto): PreviewSalesRecordResponseDto {
    // 构建临时的 PreparedSalesItem 数组，用于金额聚合
    const preparedItems: PreparedSalesItem[] = dto.items.map((item) => ({
      productId: null, // preview 不依赖 productId
      productName: item.productName,
      categoryName: item.categoryName,
      salePrice: Money.fromInputYuan(item.salePrice),
      profit: Money.fromInputYuan(item.profit),
      quantity: item.quantity,
      countsTowardTotalQuantity: true, // preview 阶段全部计入
    }));

    // 使用统一金额聚合域计算权威金额
    const amountsSnapshot = SalesRecordAmountsDomain.aggregateFromPreparedItems(preparedItems);

    // 组装预览响应
    const items: PreviewSalesRecordItemDto[] = amountsSnapshot.items.map((item, index) => ({
      productId: dto.items[index].productId ?? '',
      productName: dto.items[index].productName,
      categoryName: dto.items[index].categoryName,
      salePrice: dto.items[index].salePrice,
      profit: dto.items[index].profit,
      quantity: item.quantity,
      revenueSubtotal: item.subtotal,
      profitSubtotal: item.profitSubtotal,
    }));

    return {
      items,
      totalRevenue: amountsSnapshot.totalRevenue,
      totalProfit: amountsSnapshot.totalProfit,
      totalQuantity: amountsSnapshot.totalQuantity,
    };
  }
}
