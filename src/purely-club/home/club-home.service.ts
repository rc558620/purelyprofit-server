import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
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
    // 防御性校验：确保上下文已被拦截器正确解析
    if (!currentContext?.user || !currentContext?.store) {
      throw new BadRequestException(
        '当前请求缺少 purely-club 上下文，请重新进入',
      );
    }

    // 并行请求所有首页数据，对非关键数据做降级处理
    const [currentStore, account, promotions, featuredProducts] =
      await Promise.all([
        this.fetchCurrentStore(currentContext),
        this.fetchAccount(currentContext),
        this.fetchPromotions(currentContext),
        this.fetchFeaturedProducts(currentContext),
      ]);

    if (!currentStore) {
      this.logger.error('首页所有子服务均不可用，门店信息获取失败且无法降级');
      throw new ServiceUnavailableException(
        '首页门店信息暂时不可用，请稍后重试',
      );
    }

    // account 降级语义：区分「获取失败」与「无会员记录」
    const accountStatus = account === null ? 'unavailable' : 'active';

    return {
      currentStore,
      account,
      accountStatus,
      promotions: promotions.items,
      featuredProducts: featuredProducts.items,
    };
  }

  private async fetchCurrentStore(
    currentContext: ClubCurrentContext,
  ): Promise<Awaited<ReturnType<ClubStoresService['getCurrent']>> | null> {
    try {
      return await this.clubStoresService.getCurrent(currentContext);
    } catch (error) {
      this.logger.warn('首页门店信息获取失败，降级返回', error);
      return null;
    }
  }

  private async fetchAccount(
    currentContext: ClubCurrentContext,
  ): Promise<Awaited<ReturnType<ClubMemberService['getAccount']>> | null> {
    try {
      return await this.clubMemberService.getAccount(currentContext);
    } catch (error) {
      this.logger.warn('首页会员账户获取失败，降级返回', error);
      return null;
    }
  }

  private async fetchPromotions(
    currentContext: ClubCurrentContext,
  ): Promise<Awaited<ReturnType<ClubPromotionsService['list']>>> {
    try {
      return await this.clubPromotionsService.list(currentContext);
    } catch (error) {
      this.logger.warn('首页活动列表获取失败，降级返回空列表', error);
      return { items: [] };
    }
  }

  private async fetchFeaturedProducts(
    currentContext: ClubCurrentContext,
  ): Promise<Awaited<ReturnType<ClubProductsService['list']>>> {
    try {
      return await this.clubProductsService.list(currentContext, {
        featured: true,
      });
    } catch (error) {
      this.logger.warn('首页推荐商品获取失败，降级返回空列表', error);
      return { items: [] };
    }
  }
}
