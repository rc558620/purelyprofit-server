import { Injectable } from '@nestjs/common';
import { ClubMemberService } from '../member/club-member.service';
import { ClubProductsService } from '../products/club-products.service';
import { ClubPromotionsService } from '../promotions/club-promotions.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubStoresService } from '../stores/club-stores.service';
import type { ClubHomeResponseDto } from './dto/club-home.dto';

@Injectable()
export class ClubHomeService {
  constructor(
    private readonly clubStoresService: ClubStoresService,
    private readonly clubMemberService: ClubMemberService,
    private readonly clubPromotionsService: ClubPromotionsService,
    private readonly clubProductsService: ClubProductsService,
  ) {}

  async getHome(currentContext: ClubCurrentContext): Promise<ClubHomeResponseDto> {
    const [currentStore, account, promotions, featuredProducts] = await Promise.all([
      this.clubStoresService.getCurrent(currentContext),
      this.clubMemberService.getAccount(currentContext),
      this.clubPromotionsService.list(currentContext),
      this.clubProductsService.list(currentContext, { featured: true }),
    ]);

    return {
      currentStore,
      account,
      promotions: promotions.items,
      featuredProducts: featuredProducts.items,
    };
  }
}
