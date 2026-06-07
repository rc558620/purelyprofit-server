import { Injectable } from '@nestjs/common';
import {
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SpaceReservationsStateService } from './space-reservations-state.service';

@Injectable()
export class SpaceSessionReadStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservationsStateService: SpaceReservationsStateService,
  ) {}

  async syncOccupiedSpaceStates(storeId: number): Promise<void> {
    const occupiedSpaces = await this.prisma.space.findMany({
      where: {
        storeId,
        status: PrismaSpaceStatus.occupied,
      },
      select: {
        id: true,
      },
    });

    if (occupiedSpaces.length === 0) {
      return;
    }

    for (const space of occupiedSpaces) {
      const activeSession = await this.prisma.spaceSession.findFirst({
        where: {
          spaceId: space.id,
          status: PrismaSpaceSessionStatus.active,
        },
        select: { id: true },
      });

      if (!activeSession) {
        await this.reservationsStateService.repairInconsistentOccupiedSpace(
          space.id,
        );
      }
    }
  }
}
