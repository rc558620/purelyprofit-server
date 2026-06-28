import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import { ClubCurrentContextInterceptor } from '../stores/club-current-context.interceptor';
import { CurrentClubContext } from '../stores/current-club-context.decorator';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CacheControl } from '../../shared/cache-control.decorator';
import { ClubProductsService } from './club-products.service';
import {
  ClubProductDto,
  ClubProductsResponseDto,
  ListClubProductsQueryDto,
} from './dto/club-product.dto';

@ApiTags('Club / Products')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/products')
export class ClubProductsController {
  constructor(private readonly clubProductsService: ClubProductsService) {}

  @CacheControl({ maxAge: 30 })
  @Get()
  @ApiOperation({
    summary: '获取 purely-club 当前门店服务商品列表',
    description:
      '返回当前登录 purely-club 用户当前门店下的可售服务商品列表，可按 featured 过滤首页精选商品。',
  })
  @ApiOkResponse({ type: ClubProductsResponseDto })
  list(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Query() query: ListClubProductsQueryDto,
  ): Promise<ClubProductsResponseDto> {
    return this.clubProductsService.list(currentContext, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: '获取 purely-club 当前门店服务商品详情',
    description:
      '返回当前登录 purely-club 用户当前门店下指定服务商品详情，用于 serviceDetail 页面展示。',
  })
  @ApiOkResponse({ type: ClubProductDto })
  getDetail(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('id', ParseIntPipe) productId: number,
  ): Promise<ClubProductDto> {
    return this.clubProductsService.getDetail(currentContext, productId);
  }
}
