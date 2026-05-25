import type {
  PulseSessionMembershipDto,
  PulseSessionStoreDto,
  PulseSessionUserDto,
} from './dto/session-bootstrap.dto';

export interface UserProfileRow {
  id: number;
  name: string | null;
  avatar: string | null;
  realName: string | null;
  idNumber: string | null;
}

export interface MembershipProfileRow {
  currentPlanId: string | null;
  planName: string | null;
  expiresAt: Date | null;
}

export interface SessionBootstrapData {
  mode: 'normal' | 'developer';
  user: PulseSessionUserDto;
  store: PulseSessionStoreDto | null;
  membership: PulseSessionMembershipDto;
  unreadNotificationCount: number;
  targetStoreSelected: boolean;
  hasOnboarded: boolean;
}
