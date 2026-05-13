import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateStoreDto } from './dto/create-store.dto';
import { StoreResponseDto } from './dto/store-response.dto';
import { StoresService } from './stores.service';

@ApiTags('Stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Post()
  @ApiOperation({ summary: '创建门店' })
  @ApiCreatedResponse({
    description: '创建成功并返回前端对齐后的门店信息',
    type: StoreResponseDto,
  })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    return this.storesService.create(request.user, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取当前账号绑定门店' })
  @ApiOkResponse({
    description: '返回当前账号唯一绑定的门店信息',
    type: StoreResponseDto,
  })
  getStore(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<StoreResponseDto> {
    return this.storesService.getStore(request.user);
  }

  @Get('current')
  @ApiOperation({ summary: '获取当前账号门店' })
  @ApiOkResponse({
    description: '返回当前账号唯一绑定的门店信息',
    type: StoreResponseDto,
  })
  getCurrent(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<StoreResponseDto> {
    return this.storesService.getCurrent(request.user);
  }

  @Patch('current')
  @ApiOperation({ summary: '更新当前账号门店' })
  @ApiOkResponse({
    description: '更新成功并返回前端对齐后的门店信息',
    type: StoreResponseDto,
  })
  updateCurrent(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    return this.storesService.updateCurrent(request.user, dto);
  }
}
