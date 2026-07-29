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
  Res,
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
  CreateSpaceDto,
  GetSpacesDashboardQueryDto,
  ListSpacesQueryDto,
  SpaceResponseDto,
  SpacesDashboardResponseDto,
  UpdateSpaceDto,
} from './dto/space.dto';
import { SpaceDashboardService } from './space-dashboard.service';
import { SpacesService } from './spaces.service';
import {
  SpaceQrCodeService,
  type SpaceQrCodePreview,
} from './space-qr-code.service';

@ApiTags('Spaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('general')
@Controller('spaces')
export class SpacesController {
  constructor(
    private readonly spacesService: SpacesService,
    private readonly spaceDashboardService: SpaceDashboardService,
    private readonly spaceQrCodeService: SpaceQrCodeService,
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

  @Get(':id/qr-code')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间二维码预览' })
  @ApiOkResponse()
  getQrCode(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) spaceId: number,
  ): Promise<SpaceQrCodePreview> {
    return this.spaceQrCodeService.getPreview(ctx.user, spaceId);
  }

  @Post(':id/qr-code/rotate')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '轮换空间二维码（旧二维码立即失效）' })
  @ApiOkResponse()
  rotateQrCode(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) spaceId: number,
  ): Promise<SpaceQrCodePreview> {
    return this.spaceQrCodeService.rotate(ctx.user, spaceId);
  }

  @Get(':id/qr-code/download')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '下载空间二维码 PNG' })
  async downloadQrCode(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) spaceId: number,
    @Res()
    response: {
      header(name: string, value: string): unknown;
      send(payload: Buffer): void;
    },
  ): Promise<void> {
    const { filename, png } = await this.spaceQrCodeService.download(
      ctx.user,
      spaceId,
    );
    response.header('Content-Type', 'image/png');
    response.header(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    response.send(png);
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
