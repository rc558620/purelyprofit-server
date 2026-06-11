import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';

export const clubAccessibleStoreSelect = {
  id: true,
  name: true,
  address: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StoreSelect;

export type ClubAccessibleStoreRecord = Prisma.StoreGetPayload<{
  select: typeof clubAccessibleStoreSelect;
}>;

export interface ClubCurrentContext {
  user: AuthenticatedUser;
  store: ClubAccessibleStoreRecord;
}
