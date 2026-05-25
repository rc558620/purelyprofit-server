import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { StaffProfileService } from './staff-profile.service';
import { ActivateStaffDto } from './dto/activate-staff.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { StaffActivationResponseDto } from './dto/staff-activation-response.dto';
import { StaffInviteResponseDto } from './dto/staff-invite-response.dto';
import {
  ListStaffQueryDto,
  PaginatedStaffResponseDto,
  StaffResponseDto,
} from './dto/staff-response.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class StaffService {
  constructor(private readonly staffProfileService: StaffProfileService) {}

  create(
    user: AuthenticatedUser,
    dto: CreateStaffDto,
  ): Promise<StaffResponseDto> {
    return this.staffProfileService.create(user, dto);
  }

  invite(
    user: AuthenticatedUser,
    dto: InviteStaffDto,
  ): Promise<StaffInviteResponseDto> {
    return this.staffProfileService.invite(user, dto);
  }

  activate(
    user: AuthenticatedUser,
    dto: ActivateStaffDto,
  ): Promise<StaffActivationResponseDto> {
    return this.staffProfileService.activate(user, dto);
  }

  list(
    user: AuthenticatedUser,
    query: ListStaffQueryDto,
  ): Promise<PaginatedStaffResponseDto> {
    return this.staffProfileService.list(user, query);
  }

  update(
    user: AuthenticatedUser,
    staffId: number,
    dto: UpdateStaffDto,
  ): Promise<StaffResponseDto> {
    return this.staffProfileService.update(user, staffId, dto);
  }

  remove(user: AuthenticatedUser, staffId: number): Promise<void> {
    return this.staffProfileService.remove(user, staffId);
  }
}
