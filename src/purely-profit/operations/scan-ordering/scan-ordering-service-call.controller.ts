import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  ListScanOrderingServiceCallsDto,
  ProcessScanOrderingServiceCallDto,
} from './dto/scan-ordering-service-call.dto';
import { ScanOrderingServiceCallService } from './scan-ordering-service-call.service';

/** 扫码点餐服务呼叫域：商家端待办列表与响应处理。 */
@ApiTags('PurelyProfit Scan Ordering - Service Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('catering')
@Controller('profit/scan-ordering/service-calls')
export class ScanOrderingServiceCallController {
  constructor(
    private readonly serviceCallService: ScanOrderingServiceCallService,
  ) {}

  @Get()
  @RequirePermissions('service-call:view')
  @ApiOperation({ summary: '获取商家端扫码点餐服务呼叫待办' })
  listServiceCalls(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListScanOrderingServiceCallsDto,
  ): Promise<
    Array<{
      id: number;
      type: string;
      status: string;
      requestedAt: Date;
      processingStartedAt: Date | null;
      completedAt: Date | null;
      locationLabel: string | null;
      remark: string | null;
    }>
  > {
    return this.serviceCallService.list(user, dto);
  }

  @Post(':serviceCallId/process')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({ summary: '确认响应或完成服务呼叫' })
  processServiceCall(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serviceCallId', ParseIntPipe) serviceCallId: number,
    @Body() dto: ProcessScanOrderingServiceCallDto,
  ): Promise<void> {
    return this.serviceCallService.process(user, serviceCallId, dto);
  }
}
