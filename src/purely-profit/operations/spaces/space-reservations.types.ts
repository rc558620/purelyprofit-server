import { SpaceReservationStatus as PrismaSpaceReservationStatus } from '@prisma/client';
import type {
  CreateSpaceReservationDto,
  UpdateSpaceReservationDto,
} from './dto/space-reservation.dto';

export interface SpaceReservationRecord {
  id: number;
  spaceId: number;
  guestName: string;
  phone: string | null;
  reservedAt: Date;
  reservedEndAt: Date | null;
  guestCount: number | null;
  note: string | null;
  status: PrismaSpaceReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NormalizedSpaceReservationPayload {
  guestName: string;
  phone: string;
  reservedAt: number;
  reservedEndAt: number;
  guestCount?: number;
  note?: string;
}

export interface SpaceReservationDateFilter {
  gte?: Date;
  lte?: Date;
}

export interface SpaceReservationSessionSnapshot {
  reservationId: number | null;
  guestName: string | null;
  guestPhone: string | null;
  spaceId: number;
  startTime: Date;
}

export type SpaceReservationMutationDto =
  | CreateSpaceReservationDto
  | UpdateSpaceReservationDto;
