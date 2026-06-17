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

    const occupiedSpaceIds = occupiedSpaces.map((space) => space.id);

    const activeSessions = await this.prisma.spaceSession.findMany({
      where: {
        spaceId: { in: occupiedSpaceIds },
        status: PrismaSpaceSessionStatus.active,
      },
      select: {
        spaceId: true,
      },
    });

    const spacesWithActiveSession = new Set(
      activeSessions.map((session) => session.spaceId),
    );

    const inconsistentSpaceIds = occupiedSpaceIds.filter(
      (id) => !spacesWithActiveSession.has(id),
    );

    if (inconsistentSpaceIds.length === 0) {
      return;
    }

    await Promise.all(
      inconsistentSpaceIds.map((spaceId) =>
        this.reservationsStateService.repairInconsistentOccupiedSpace(spaceId),
      ),
    );
  }
}
