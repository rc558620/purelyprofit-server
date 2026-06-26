import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class SpaceSessionReadStateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Space.status 已移除，此方法已废弃。
   * 原逻辑：查找所有 status=occupied 的空间，检查是否真的有 active session，修复不一致。
   * 现状：空间状态由运行态推导，无需同步/修复。
   * @deprecated
   */
  syncOccupiedSpaceStates(_storeId: number): Promise<void> {
    return Promise.resolve();
  }
}
