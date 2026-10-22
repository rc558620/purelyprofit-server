// 服务详情页首屏聚合接口：GET /club/products/:id/bootstrap
import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClubJwtAuthGuard } from '../../../purely-profit/auth/guards/jwt-auth.guard';
import type { ClubCurrentContext } from '../../stores/club-stores.types';
import { ClubCurrentContextInterceptor } from '../../stores/club-current-context.interceptor';
import { CurrentClubContext } from '../../stores/current-club-context.decorator';
import { ClubProductBootstrapService } from './club-product-bootstrap.service';
import { ClubProductBootstrapResponseDto } from './dto/club-product-bootstrap.dto';

@ApiTags('Club / Products')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/products')
export class ClubProductBootstrapController {
  constructor(
    private readonly clubProductBootstrapService: ClubProductBootstrapService,
  ) {}

  @Get(':id/bootstrap')
  @ApiOperation({
    summary: '获取 purely-club 服务详情页首屏聚合数据',
    description:
      '一次请求拿回商品详情、会员账户、当前门店 ID、积分规则与初始规格的价格预计算（不创建订单），用于 serviceDetail 页面首屏渲染。',
  })
  @ApiOkResponse({ type: ClubProductBootstrapResponseDto })
  getBootstrap(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('id', ParseIntPipe) productId: number,
  ): Promise<ClubProductBootstrapResponseDto> {
    return this.clubProductBootstrapService.getBootstrap(
      currentContext,
      productId,
    );
  }
}
