import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  PulseSessionBootstrapResponseDto,
  PulseSwitchCurrentStoreDto,
  PulseSwitchCurrentStoreResponseDto,
} from './dto/session-bootstrap.dto';
import { SessionService } from './session.service';

@ApiTags('Pulse / Session')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /**
   * Pulse 首屏上下文接口。
   *
   * 默认按“开发者查看目标商家”语义返回当前登录开发者摘要、当前选中的目标商家门店、
   * 该目标商家的平台订阅状态、相关提醒与观察对象选择兼容标记。
   */
  @Get('bootstrap')
  @ApiOperation({
    summary: 'Pulse 首屏上下文数据',
    description:
      'Pulse 当前默认按开发者查看目标商家的语义返回数据。user 表示当前登录开发者，store 与 membership 表示当前选中的目标商家门店及其平台订阅状态，' +
      'targetStoreSelected 为新的目标门店选择状态字段，hasOnboarded 为兼容字段（deprecated）。前端应在登录成功和 App 恢复前台时调用。',
  })
  @ApiOkResponse({
    description: '返回 Pulse 启动所需的聚合数据',
    type: PulseSessionBootstrapResponseDto,
  })
  bootstrap(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PulseSessionBootstrapResponseDto> {
    return this.sessionService.bootstrap(request.user);
  }

  /**
   * 切换当前观察的目标门店。
   *
   * 该接口只切换 Pulse 当前查看的目标商家门店，不改变登录态本身。
   * 默认面向开发者观察态；兼容模式下普通商家账号仍只允许切换到自己可访问的门店。
   */
  @Patch('current-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '切换当前观察的目标门店',
    description:
      '切换 Pulse 当前查看的目标商家门店。默认按开发者观察态理解；兼容模式下普通商家账号只能切到自己可访问的门店，开发者账号可切到任意目标门店。',
  })
  @ApiOkResponse({
    description: '切换成功，返回新的目标门店摘要',
    type: PulseSwitchCurrentStoreResponseDto,
  })
  switchCurrentStore(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: PulseSwitchCurrentStoreDto,
  ): Promise<PulseSwitchCurrentStoreResponseDto> {
    return this.sessionService.switchCurrentStore(request.user, dto.storeId);
  }
}
