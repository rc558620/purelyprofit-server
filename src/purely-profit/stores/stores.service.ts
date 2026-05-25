import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateStoreDto } from './dto/create-store.dto';
import type { StoreResponseDto } from './dto/store-response.dto';
import { StoresReadService } from './stores-read.service';
import { StoresWriteService } from './stores-write.service';

@Injectable()
export class StoresService {
  constructor(
    private readonly storesReadService: StoresReadService,
    private readonly storesWriteService: StoresWriteService,
  ) {}

  create(
    user: AuthenticatedUser,
    dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    return this.storesWriteService.create(user, dto);
  }

  getStore(user: AuthenticatedUser): Promise<StoreResponseDto> {
    return this.storesReadService.getStore(user);
  }

  getCurrent(user: AuthenticatedUser): Promise<StoreResponseDto> {
    return this.storesReadService.getCurrent(user);
  }

  updateCurrent(
    user: AuthenticatedUser,
    dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    return this.storesWriteService.updateCurrent(user, dto);
  }
}
