import { Global, Module } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { SubjectCapabilityService } from './subject-capability.service';
import { PermissionsGuard } from './guards/permissions.guard';
import { SubAccountBlockGuard } from './guards/sub-account-block.guard';

@Global()
@Module({
  providers: [
    AccessControlService,
    SubjectCapabilityService,
    PermissionsGuard,
    SubAccountBlockGuard,
  ],
  exports: [
    AccessControlService,
    SubjectCapabilityService,
    PermissionsGuard,
    SubAccountBlockGuard,
  ],
})
export class AccessControlModule {}
