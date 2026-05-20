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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
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
   * 老板端登录后首屏初始化接口。
   *
   * 返回登录用户摘要、当前门店、平台会员状态、未读通知数、入驻状态。
   * 前端在应用启动或重新进入前台时调用一次，用于驱动首屏渲染。
   */
  @Get('bootstrap')
  @ApiOperation({
    summary: '老板端首屏启动数据',
    description:
      '返回当前登录用户摘要、绑定门店、平台会员状态摘要、未读通知数和入驻完成状态。' +
      '前端应在登录成功和 App 恢复前台时调用。',
  })
  @ApiOkResponse({
    description: '返回老板端启动所需的聚合数据',
    type: PulseSessionBootstrapResponseDto,
  })
  bootstrap(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PulseSessionBootstrapResponseDto> {
    return this.sessionService.bootstrap(request.user);
  }

  /**
   * 切换当前门店。
   *
   * 当前数据层是"一个老板对应一个门店"的唯一约束（User ↔ Store 1:1），
   * 此接口在数据层约束放开前做防御校验，确保目标门店属于当前用户。
   * 切换成功后返回目标门店摘要，前端负责在本地更新上下文。
   */
  @Patch('current-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '切换当前门店',
    description:
      '切换老板端当前操作的门店。当前架构每个老板只能有一个门店，' +
      '此接口做归属校验，为后续多门店能力提前预留扩展点。',
  })
  @ApiOkResponse({
    description: '切换成功，返回目标门店摘要',
    type: PulseSwitchCurrentStoreResponseDto,
  })
  switchCurrentStore(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: PulseSwitchCurrentStoreDto,
  ): Promise<PulseSwitchCurrentStoreResponseDto> {
    return this.sessionService.switchCurrentStore(request.user, dto.storeId);
  }
}
