import { Injectable, Logger } from '@nestjs/common';
import { ClubMemberService } from '../member/club-member.service';
import { ClubProductsService } from '../products/club-products.service';
import { ClubPromotionsService } from '../promotions/club-promotions.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubStoresService } from '../stores/club-stores.service';
import type { ClubHomeResponseDto } from './dto/club-home.dto';

@Injectable()
export class ClubHomeService {
  private readonly logger = new Logger(ClubHomeService.name);

  constructor(
    private readonly clubStoresService: ClubStoresService,
    private readonly clubMemberService: ClubMemberService,
    private readonly clubPromotionsService: ClubPromotionsService,
    private readonly clubProductsService: ClubProductsService,
  ) {}

  async getHome(
    currentContext: ClubCurrentContext,
  ): Promise<ClubHomeResponseDto> {
    // 并行请求所有首页数据，对非关键数据做降级处理
    const [currentStore, account, promotions, featuredProducts] =
      await Promise.all([
        this.clubStoresService.getCurrent(currentContext).catch((error) => {
          this.logger.warn('首页门店信息获取失败，降级返回', error);
          return null;
        }),
        this.clubMemberService.getAccount(currentContext).catch((error) => {
          this.logger.warn('首页会员账户获取失败，降级返回', error);
          return null;
        }),
        this.clubPromotionsService.list(currentContext).catch((error) => {
          this.logger.warn('首页活动列表获取失败，降级返回空列表', error);
          return { items: [] };
        }),
        this.clubProductsService
          .list(currentContext, { featured: true })
          .catch((error) => {
            this.logger.warn('首页推荐商品获取失败，降级返回空列表', error);
            return { items: [] };
          }),
      ]);

    if (!currentStore) {
      throw new Error('首页必需的门店信息获取失败，无法降级');
    }

    return {
      currentStore,
      account,
      promotions: promotions.items,
      featuredProducts: featuredProducts.items,
    };
  }
}
