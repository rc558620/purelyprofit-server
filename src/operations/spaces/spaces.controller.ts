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
  Req,
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
  CreateSpaceDto,
  GetSpacesDashboardQueryDto,
  ListSpacesQueryDto,
  SpaceResponseDto,
  SpacesDashboardResponseDto,
  UpdateSpaceDto,
  UpdateSpaceStatusDto,
} from './dto/space.dto';
import { SpacesService } from './spaces.service';

@ApiTags('Spaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('spaces')
export class SpacesController {
  constructor(private readonly spacesService: SpacesService) {}

  @Get('dashboard')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间管理看板数据' })
  @ApiOkResponse({ type: SpacesDashboardResponseDto })
  getDashboard(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: GetSpacesDashboardQueryDto,
  ): Promise<SpacesDashboardResponseDto> {
    return this.spacesService.getSpacesDashboard(request.user, query);
  }

  @Get()
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间列表' })
  @ApiOkResponse({ type: [SpaceResponseDto] })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListSpacesQueryDto,
  ): Promise<SpaceResponseDto[]> {
    return this.spacesService.listSpaces(request.user, query);
  }

  @Post()
  @RequirePermissions('space:create')
  @ApiOperation({ summary: '新增空间' })
  @ApiCreatedResponse({ type: SpaceResponseDto })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateSpaceDto,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.createSpace(request.user, dto);
  }

  @Patch(':id')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '更新空间' })
  @ApiOkResponse({ type: SpaceResponseDto })
  update(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) spaceId: number,
    @Body() dto: UpdateSpaceDto,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.updateSpace(request.user, spaceId, dto);
  }

  @Post(':id/mark-ready')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '标记空间为可用' })
  @ApiOkResponse({ type: SpaceResponseDto })
  markReady(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) spaceId: number,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.markSpaceReady(request.user, spaceId);
  }

  @Patch(':id/status')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '更新空间状态（兼容前端状态接口）' })
  @ApiOkResponse({ type: SpaceResponseDto })
  updateStatus(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) spaceId: number,
    @Body() dto: UpdateSpaceStatusDto,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.updateSpaceStatus(request.user, spaceId, dto);
  }

  @Delete(':id')
  @RequirePermissions('space:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除空间' })
  @ApiNoContentResponse()
  async remove(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) spaceId: number,
  ): Promise<void> {
    await this.spacesService.removeSpace(request.user, spaceId);
  }
}
