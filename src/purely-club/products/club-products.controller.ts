import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubProductsService } from './club-products.service';
import {
  ClubProductDto,
  ClubProductsResponseDto,
  ListClubProductsQueryDto,
} from './dto/club-product.dto';

@ApiTags('Club / Products')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@Controller('club/products')
export class ClubProductsController {
  constructor(private readonly clubProductsService: ClubProductsService) {}

  @Get()
  @ApiOperation({
    summary: '获取 purely-club 当前门店服务商品列表',
    description:
      '返回当前登录 purely-club 用户当前门店下的可售服务商品列表，可按 featured 过滤首页精选商品。',
  })
  @ApiOkResponse({ type: ClubProductsResponseDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListClubProductsQueryDto,
  ): Promise<ClubProductsResponseDto> {
    return this.clubProductsService.list(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: '获取 purely-club 当前门店服务商品详情',
    description:
      '返回当前登录 purely-club 用户当前门店下指定服务商品详情，用于 serviceDetail 页面展示。',
  })
  @ApiOkResponse({ type: ClubProductDto })
  getDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) productId: number,
  ): Promise<ClubProductDto> {
    return this.clubProductsService.getDetail(user, productId);
  }
}
