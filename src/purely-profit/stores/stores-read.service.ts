import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { findBoundStoreRecord } from './stores-bound-store.query';
import type {
  StoreRecordSnapshot,
  StoreResponseDto,
} from './dto/store-response.dto';
import { StoresProfileService } from './stores-profile.service';

@Injectable()
export class StoresReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storesProfileService: StoresProfileService,
  ) {}

  async getCurrent(user: AuthenticatedUser): Promise<StoreResponseDto> {
    const store = await this.getBoundStoreRecordOrThrow(user);
    return this.storesProfileService.mapStoreResponse(store);
  }

  async getBoundStoreRecordOrThrow(
    user: AuthenticatedUser,
  ): Promise<StoreRecordSnapshot> {
    const store = await this.findBoundStoreRecord(user);

    if (!store) {
      throw new NotFoundException('当前账号暂无门店');
    }

    return store;
  }

  findBoundStoreRecord(
    user: AuthenticatedUser,
  ): Promise<StoreRecordSnapshot | null> {
    return findBoundStoreRecord(this.prisma, user);
  }
}
