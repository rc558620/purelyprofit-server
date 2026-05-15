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
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CreateSpaceTypeDto,
  ListSpaceTypesQueryDto,
  SpaceTypeResponseDto,
  UpdateSpaceTypeDto,
} from './dto/space-type.dto';
import { SpacesService } from './spaces.service';

@ApiTags('SpaceTypes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('space-types')
export class SpaceTypesController {
  constructor(private readonly spacesService: SpacesService) {}

  @Get()
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间类型列表' })
  @ApiOkResponse({ type: [SpaceTypeResponseDto] })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListSpaceTypesQueryDto,
  ): Promise<SpaceTypeResponseDto[]> {
    return this.spacesService.listSpaceTypes(request.user, query);
  }

  @Post()
  @RequirePermissions('space:create')
  @ApiOperation({ summary: '新增空间类型' })
  @ApiCreatedResponse({ type: SpaceTypeResponseDto })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateSpaceTypeDto,
  ): Promise<SpaceTypeResponseDto> {
    return this.spacesService.createSpaceType(request.user, dto);
  }

  @Patch(':id')
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '更新空间类型' })
  @ApiOkResponse({ type: SpaceTypeResponseDto })
  update(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) typeId: number,
    @Body() dto: UpdateSpaceTypeDto,
  ): Promise<SpaceTypeResponseDto> {
    return this.spacesService.updateSpaceType(request.user, typeId, dto);
  }

  @Delete(':id')
  @RequirePermissions('space:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除空间类型' })
  @ApiNoContentResponse()
  async remove(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) typeId: number,
  ): Promise<void> {
    await this.spacesService.removeSpaceType(request.user, typeId);
  }
}
