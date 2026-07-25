import {
  UserWithRequestId,
  type UserWithRequestIdValue,
} from '../../auth/user-with-request-id.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  CreateSpaceZoneDto,
  ListSpaceZonesQueryDto,
  SpaceZoneResponseDto,
  UpdateSpaceZoneDto,
} from './dto/space-zone.dto';
import { SpaceZonesService } from './space-zones.service';

@ApiTags('SpaceZones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('general')
@Controller('space-zones')
export class SpaceZonesController {
  constructor(private readonly spaceZonesService: SpaceZonesService) {}

  @Get()
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间区域列表' })
  @ApiOkResponse({ type: [SpaceZoneResponseDto] })
  list(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Query() query: ListSpaceZonesQueryDto,
  ): Promise<SpaceZoneResponseDto[]> {
    return this.spaceZonesService.listSpaceZones(ctx.user, query);
  }

  @Post()
  @RequirePermissions('space:create')
  @ApiOperation({ summary: '新增空间区域' })
  @ApiCreatedResponse({ type: SpaceZoneResponseDto })
  create(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Body() dto: CreateSpaceZoneDto,
  ): Promise<SpaceZoneResponseDto> {
    return this.spaceZonesService.createSpaceZone(ctx.user, dto);
  }

  @Patch(':id')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '更新空间区域' })
  @ApiOkResponse({ type: SpaceZoneResponseDto })
  update(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) zoneId: number,
    @Body() dto: UpdateSpaceZoneDto,
  ): Promise<SpaceZoneResponseDto> {
    return this.spaceZonesService.updateSpaceZone(ctx.user, zoneId, dto);
  }

  @Delete(':id')
  @RequirePermissions('space:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除空间区域' })
  @ApiNoContentResponse()
  async remove(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) zoneId: number,
  ): Promise<void> {
    await this.spaceZonesService.removeSpaceZone(ctx.user, zoneId);
  }
}
