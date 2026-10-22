// 服务详情页首屏聚合模块。
//
// 刻意独立成模块而不是塞进 ClubProductsModule：预计算依赖 ClubOrdersModule 与
// ClubVoucherOrdersModule（后者还拖着微信支付与扫码点餐），放进商品模块会把这条重型
// 依赖链灌给所有引用商品的模块（首页聚合等）。这里只被 app.module 注册一次。
import { Module } from '@nestjs/common';
import { ClubMemberModule } from '../../member/club-member.module';
import { ClubOrdersModule } from '../../orders/club-orders.module';
import { ClubStoresModule } from '../../stores/club-stores.module';
import { ClubProductsModule } from '../club-products.module';
import { ClubVoucherOrdersModule } from '../../voucher-orders/club-voucher-orders.module';
import { ClubProductBootstrapController } from './club-product-bootstrap.controller';
import { ClubProductBootstrapService } from './club-product-bootstrap.service';

@Module({
  imports: [
    ClubProductsModule,
    ClubMemberModule,
    ClubOrdersModule,
    ClubVoucherOrdersModule,
    // 控制器依赖 ClubCurrentContextInterceptor 解析门店上下文，它由 ClubStoresModule 提供并导出；
    // 漏掉这条导入会在实例化拦截器时抛 UnknownDependenciesException（整个应用起不来）。
    ClubStoresModule,
  ],
  controllers: [ClubProductBootstrapController],
  providers: [ClubProductBootstrapService],
})
export class ClubProductBootstrapModule {}
