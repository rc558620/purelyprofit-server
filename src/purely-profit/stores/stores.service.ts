import { ForbiddenException, Injectable } from '@nestjs/common';
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
    this.ensureOwnerOnly(user, '子账号无权访问门店设置');
    return this.storesWriteService.create(user, dto);
  }

  getStore(user: AuthenticatedUser): Promise<StoreResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问门店设置');
    return this.storesReadService.getStore(user);
  }

  getCurrent(user: AuthenticatedUser): Promise<StoreResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问门店设置');
    return this.storesReadService.getCurrent(user);
  }

  updateCurrent(
    user: AuthenticatedUser,
    dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    this.ensureOwnerOnly(user, '子账号无权访问门店设置');
    return this.storesWriteService.updateCurrent(user, dto);
  }

  private ensureOwnerOnly(user: AuthenticatedUser, message: string): void {
    if (user.currentMembership?.subjectType === 'sub_account') {
      throw new ForbiddenException(message);
    }
  }
}
