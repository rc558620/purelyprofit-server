import { CurrentUser } from '../auth/current-user.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { StoreSubscriptionResponseDto } from './dto/store-subscription-response.dto';
import { UpdateStoreSubscriptionDto } from './dto/update-store-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('stores/:storeId')
  @ApiOperation({ summary: '获取门店当前套餐订阅与席位概览' })
  @ApiOkResponse({
    description: '返回门店当前套餐、状态与席位占用概览',
    type: StoreSubscriptionResponseDto,
  })
  getStoreSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId', ParseIntPipe) storeId: number,
  ): Promise<StoreSubscriptionResponseDto> {
    return this.subscriptionsService.getStoreSubscription(user, storeId);
  }

  @Patch('stores/:storeId')
  @ApiOperation({ summary: '更新门店套餐并同步账号席位' })
  @ApiOkResponse({
    description: '更新成功并返回最新套餐与席位概览',
    type: StoreSubscriptionResponseDto,
  })
  updateStoreSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Body() dto: UpdateStoreSubscriptionDto,
  ): Promise<StoreSubscriptionResponseDto> {
    return this.subscriptionsService.updateStoreSubscription(
      user,
      storeId,
      dto,
    );
  }
}
