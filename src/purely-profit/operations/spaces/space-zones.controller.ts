import { CurrentUser } from '../../auth/current-user.decorator';
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  CreateSpaceZoneDto,
  ListSpaceZonesQueryDto,
  SpaceZoneResponseDto,
  UpdateSpaceZoneDto,
} from './dto/space-zone.dto';
import { SpaceZonesService } from './space-zones.service';

@ApiTags('SpaceZones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('space-zones')
export class SpaceZonesController {
  constructor(private readonly spaceZonesService: SpaceZonesService) {}

  @Get()
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间区域列表' })
  @ApiOkResponse({ type: [SpaceZoneResponseDto] })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSpaceZonesQueryDto,
  ): Promise<SpaceZoneResponseDto[]> {
    return this.spaceZonesService.listSpaceZones(user, query);
  }

  @Post()
  @RequirePermissions('space:create')
  @ApiOperation({ summary: '新增空间区域' })
  @ApiCreatedResponse({ type: SpaceZoneResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSpaceZoneDto,
  ): Promise<SpaceZoneResponseDto> {
    return this.spaceZonesService.createSpaceZone(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '更新空间区域' })
  @ApiOkResponse({ type: SpaceZoneResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) zoneId: number,
    @Body() dto: UpdateSpaceZoneDto,
  ): Promise<SpaceZoneResponseDto> {
    return this.spaceZonesService.updateSpaceZone(user, zoneId, dto);
  }

  @Delete(':id')
  @RequirePermissions('space:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除空间区域' })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) zoneId: number,
  ): Promise<void> {
    await this.spaceZonesService.removeSpaceZone(user, zoneId);
  }
}
