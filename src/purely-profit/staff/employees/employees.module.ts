import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { CostsModule } from '../../operations/costs/costs.module';
import { CommissionModule } from '../../operations/commission/commission.module';
import {
  EmployeesController,
  EmployeesDictionaryController,
  EmployeesLeavesController,
  EmployeesPayrollsController,
  EmployeesShiftsController,
} from './employees.controller';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesDictionaryService } from './employees-dictionary.service';
import { EmployeesLeaveService } from './employees-leave.service';
import { EmployeesPayrollService } from './employees-payroll.service';
import { EmployeesPayrollReportService } from './employees-payroll-report.service';
import { EmployeesProfileReadService } from './employees-profile-read.service';
import { EmployeesProfileWriteService } from './employees-profile-write.service';
import { EmployeesSnapshotSyncService } from './employees-snapshot-sync.service';
import { EmployeesService } from './employees.service';
import { EmployeesShiftDefinitionService } from './employees-shift-definition.service';
import { EmployeesShiftService } from './employees-shift.service';
import { EmployeesSubAccountService } from './employees-sub-account.service';

@Module({
  imports: [
    AuthModule,
    CostsModule,
    PlatformMembershipModule,
    CommissionModule,
  ],
  controllers: [
    EmployeesController,
    EmployeesDictionaryController,
    EmployeesShiftsController,
    EmployeesPayrollsController,
    EmployeesLeavesController,
  ],
  providers: [
    EmployeesService,
    EmployeesAccessService,
    EmployeesProfileReadService,
    EmployeesProfileWriteService,
    EmployeesSnapshotSyncService,
    EmployeesDictionaryService,
    EmployeesLeaveService,
    EmployeesShiftDefinitionService,
    EmployeesShiftService,
    EmployeesPayrollService,
    EmployeesPayrollReportService,
    EmployeesSubAccountService,
  ],
})
export class EmployeesModule {}
