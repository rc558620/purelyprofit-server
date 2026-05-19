import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CreateSpaceReservationDto,
  ListSpaceReservationsQueryDto,
  SpaceReservationResponseDto,
  UpdateSpaceReservationDto,
} from './dto/space-reservation.dto';
import { SpacesService } from './spaces.service';

@ApiTags('SpaceReservations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class SpaceReservationsController {
  constructor(private readonly spacesService: SpacesService) {}

  @Get('spaces/:spaceId/reservations')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取某空间预约列表' })
  @ApiOkResponse({ type: [SpaceReservationResponseDto] })
  listBySpace(
    @Req() request: { user: AuthenticatedUser },
    @Param('spaceId', ParseIntPipe) spaceId: number,
    @Query() query: ListSpaceReservationsQueryDto,
  ): Promise<SpaceReservationResponseDto[]> {
    return this.spacesService.listSpaceReservations(
      request.user,
      spaceId,
      query,
    );
  }

  @Get('space-reservations')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取当前门店空间预约快照（兼容前端读取接口）' })
  @ApiOkResponse({ type: [SpaceReservationResponseDto] })
  listStoreReservations(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListSpaceReservationsQueryDto,
  ): Promise<SpaceReservationResponseDto[]> {
    return this.spacesService.listStoreSpaceReservations(request.user, query);
  }

  @Post('spaces/:spaceId/reservations')
  @RequirePermissions('space:create')
  @ApiOperation({ summary: '新增空间预约' })
  @ApiCreatedResponse({ type: SpaceReservationResponseDto })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Param('spaceId', ParseIntPipe) spaceId: number,
    @Body() dto: CreateSpaceReservationDto,
  ): Promise<SpaceReservationResponseDto> {
    return this.spacesService.createSpaceReservation(
      request.user,
      spaceId,
      dto,
    );
  }

  @Patch('space-reservations/:id')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '更新空间预约' })
  @ApiOkResponse({ type: SpaceReservationResponseDto })
  update(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) reservationId: number,
    @Body() dto: UpdateSpaceReservationDto,
  ): Promise<SpaceReservationResponseDto> {
    return this.spacesService.updateSpaceReservation(
      request.user,
      reservationId,
      dto,
    );
  }

  @Post('space-reservations/:id/cancel')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '取消空间预约' })
  @ApiOkResponse({ type: SpaceReservationResponseDto })
  cancel(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) reservationId: number,
  ): Promise<SpaceReservationResponseDto> {
    return this.spacesService.cancelSpaceReservation(
      request.user,
      reservationId,
    );
  }
}
