import { Global, Module } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { PermissionsGuard } from './guards/permissions.guard';

@Global()
@Module({
  providers: [AccessControlService, PermissionsGuard],
  exports: [AccessControlService, PermissionsGuard],
})
export class AccessControlModule {}
