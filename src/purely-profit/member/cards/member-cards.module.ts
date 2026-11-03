// 会员卡模块：卡模板 + 持卡实例 / 核销流水 + 售卡订单 + 开台识别聚合
import { Module } from '@nestjs/common';
import { MarketingModule } from '../../marketing/marketing.module';
import { StoresModule } from '../../stores/stores.module';
import { MemberCardIdentifyService } from './member-card-identify.service';
import { MemberCardOrdersController } from './member-card-orders.controller';
import { MemberCardOrdersService } from './member-card-orders.service';
import { MemberCardPlansController } from './member-card-plans.controller';
import { MemberCardPlansService } from './member-card-plans.service';
import { MemberCardsController } from './member-cards.controller';
import { MemberCardsWriteService } from './member-cards-write.service';
import { MemberCardsService } from './member-cards.service';

/**
 * 门店权限解析（MarketingSharedService）与业态守卫依赖均由
 * MarketingModule / StoresModule 提供，这里不重复声明 provider，
 * 避免同一种访问控制在两处实现。
 *
 * 读写拆两个 service：读侧只查不写，写侧必须持有事务并写流水，
 * 便于后续段落（开台预扣 / 结账核销）直接复用写侧的事务能力。
 * 开台识别单独成 service：它要聚合顾客、持卡、团购券三类数据源，
 * 混进持卡读服务会让该文件同时承担两个业务场景。
 */
@Module({
  imports: [MarketingModule, StoresModule],
  controllers: [
    MemberCardPlansController,
    MemberCardsController,
    MemberCardOrdersController,
  ],
  providers: [
    MemberCardPlansService,
    MemberCardsService,
    MemberCardsWriteService,
    MemberCardOrdersService,
    MemberCardIdentifyService,
  ],
  exports: [
    MemberCardPlansService,
    MemberCardsService,
    MemberCardsWriteService,
    MemberCardOrdersService,
    MemberCardIdentifyService,
  ],
})
export class MemberCardsModule {}
