import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubServiceCallService } from './club-service-call.service';
import { CreateClubServiceCallDto } from './dto/create-club-service-call.dto';

@ApiTags('PurelyClub Service Calls')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@Controller('club/service-calls')
export class ClubServiceCallController {
  constructor(private readonly service: ClubServiceCallService) {}

  @Post()
  @ApiOperation({ summary: '发起或催促门店服务呼叫' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClubServiceCallDto,
  ) {
    return this.service.createFromHome(user, dto);
  }
}
