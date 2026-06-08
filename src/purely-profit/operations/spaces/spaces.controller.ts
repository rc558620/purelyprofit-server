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
import { SpaceDashboardService } from './space-dashboard.service';
import { SpacesService } from './spaces.service';

@ApiTags('Spaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('spaces')
export class SpacesController {
  constructor(
    private readonly spacesService: SpacesService,
    private readonly spaceDashboardService: SpaceDashboardService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间管理看板数据' })
  @ApiOkResponse({ type: SpacesDashboardResponseDto })
  getDashboard(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Query() query: GetSpacesDashboardQueryDto,
  ): Promise<SpacesDashboardResponseDto> {
    return this.spaceDashboardService.getSpacesDashboard(
      ctx.user,
      query,
      ctx.requestId,
    );
  }

  @Get()
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间列表' })
  @ApiOkResponse({ type: [SpaceResponseDto] })
  list(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Query() query: ListSpacesQueryDto,
  ): Promise<SpaceResponseDto[]> {
    return this.spacesService.listSpaces(ctx.user, query, ctx.requestId);
  }

  @Post()
  @RequirePermissions('space:create')
  @ApiOperation({ summary: '新增空间' })
  @ApiCreatedResponse({ type: SpaceResponseDto })
  create(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Body() dto: CreateSpaceDto,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.createSpace(ctx.user, dto);
  }

  @Patch(':id')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '更新空间' })
  @ApiOkResponse({ type: SpaceResponseDto })
  update(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) spaceId: number,
    @Body() dto: UpdateSpaceDto,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.updateSpace(ctx.user, spaceId, dto);
  }

  @Post(':id/mark-ready')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '标记空间为可用' })
  @ApiOkResponse({ type: SpaceResponseDto })
  markReady(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) spaceId: number,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.markSpaceReady(ctx.user, spaceId);
  }

  @Patch(':id/status')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '更新空间状态（兼容前端状态接口）' })
  @ApiOkResponse({ type: SpaceResponseDto })
  updateStatus(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) spaceId: number,
    @Body() dto: UpdateSpaceStatusDto,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.updateSpaceStatus(ctx.user, spaceId, dto);
  }

  @Delete(':id')
  @RequirePermissions('space:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除空间' })
  @ApiNoContentResponse()
  async remove(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) spaceId: number,
  ): Promise<void> {
    await this.spacesService.removeSpace(ctx.user, spaceId);
  }
}
