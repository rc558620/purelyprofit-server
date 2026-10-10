import { Injectable } from '@nestjs/common';
import type {
  CreateSalesRecordDto,
  PreviewSalesRecordItemDto,
  PreviewSalesRecordResponseDto,
} from './dto/sales-record.dto';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';
import {
  SalesRecordItemPreparationService,
  type CatalogProductRecord,
  type CreateSalesRecordOptions,
} from './sales-record-item-preparation.service';
import type { PreparedSalesItem } from './sales-record-item-preparation.service';
import { parseNumericProductId } from './sales-record.utils';

/**
 * 销售记录预览服务 — 不落库，仅算出权威金额供前端展示。
 * 前端在用户确认提交前调用 preview，拿到后端计算结果后直接展示，
 * 不再在前端做任何业务金额计算。
 *
 * 【重要】金额聚合必须使用 SalesRecordAmountsDomain，且**单价/利润必须与
 * create 同源**（走 SalesRecordItemPreparationService.resolveItemPrices）。
 *
 * 早期实现直接用调用方传入的 salePrice/profit，而 create 用商品目录价格，
 * 商品在录入期间被改价时会出现「预览金额 ≠ 实际入账金额」。现已统一走目录。
 *
 * 与 create 的唯一差异是校验强度：preview 回答「如果现在提交金额是多少」，
 * 因此不校验库存 / 上下架，避免用户在录入过程中被硬错误打断。
 */
@Injectable()
export class SalesRecordPreviewService {
  constructor(
    private readonly itemPreparationService: SalesRecordItemPreparationService,
  ) {}

  async preview(
    storeId: number,
    dto: CreateSalesRecordDto,
    options: CreateSalesRecordOptions = {},
  ): Promise<PreviewSalesRecordResponseDto> {
    const productMap = await this.itemPreparationService.loadProductMap(
      storeId,
      dto.items,
    );

    const preparedItems: PreparedSalesItem[] = dto.items.map((item) => {
      const { salePrice, profit } =
        this.itemPreparationService.resolveItemPrices(
          this.matchCatalogProduct(item.productId, productMap),
          item,
          options,
        );

      return {
        // preview 不落库、不扣库存，无需 DB 主键；productId 由响应侧按入参回填
        productId: null,
        productName: item.productName,
        categoryName: item.categoryName,
        salePrice,
        profit,
        quantity: item.quantity,
        countsTowardTotalQuantity: true, // preview 阶段全部计入
      };
    });

    // 使用统一金额聚合域计算权威金额（与 create 完全一致）
    const amountsSnapshot =
      SalesRecordAmountsDomain.aggregateFromPreparedItems(preparedItems);

    // 组装预览响应：金额一律取聚合域输出，保证与 create 落库值同源
    const items: PreviewSalesRecordItemDto[] = amountsSnapshot.items.map(
      (item, index) => ({
        productId: dto.items[index].productId ?? '',
        productName: dto.items[index].productName,
        categoryName: dto.items[index].categoryName,
        salePrice: item.salePrice,
        profit: item.profit,
        quantity: item.quantity,
        revenueSubtotal: item.subtotal,
        profitSubtotal: item.profitSubtotal,
      }),
    );

    return {
      items,
      totalRevenue: amountsSnapshot.totalRevenue,
      totalProfit: amountsSnapshot.totalProfit,
      totalQuantity: amountsSnapshot.totalQuantity,
    };
  }

  private matchCatalogProduct(
    productId: string | undefined,
    productMap: Map<number, CatalogProductRecord>,
  ): CatalogProductRecord | null {
    const numericProductId = parseNumericProductId(productId);
    return numericProductId === null
      ? null
      : (productMap.get(numericProductId) ?? null);
  }
}
