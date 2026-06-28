import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  STORE_SUB_ACCOUNT_ROLE_CODES,
  type StoreSubAccountRoleCode,
} from '../../../access-control/access-control.constants';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../../shared/password-policy.utils';

export const EMPLOYEE_SUB_ACCOUNT_ROLE_VALUES = STORE_SUB_ACCOUNT_ROLE_CODES;

export type EmployeeSubAccountRoleValue = StoreSubAccountRoleCode;

export class UpdateEmployeeSubAccountDto {
  @ApiProperty({
    enum: EMPLOYEE_SUB_ACCOUNT_ROLE_VALUES,
    description:
      '子账号角色：cashier=收银员视角 / manager=店长视角 / finance=财务视角',
  })
  @IsIn(EMPLOYEE_SUB_ACCOUNT_ROLE_VALUES, { message: '子账号角色不合法' })
  role: EmployeeSubAccountRoleValue;

  @ApiPropertyOptional({
    example: 'store_mgr01',
    description:
      '子账号登录账号，支持字母/数字/下划线，6~32 位；不传则沿用当前账号',
  })
  @IsOptional()
  @IsString({ message: '登录账号必须是字符串' })
  @MinLength(6, { message: '登录账号至少 6 位' })
  @MaxLength(32, { message: '登录账号最多 32 位' })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: '登录账号仅支持字母、数字或下划线',
  })
  loginAccount?: string;

  @ApiPropertyOptional({
    example: 'test123456',
    description: '子账号登录密码；首次设置建议必填，后续修改时不传则保留原密码',
  })
  @IsOptional()
  @IsString({ message: '登录密码必须是字符串' })
  @MinLength(PASSWORD_MIN_LENGTH, { message: `登录密码至少 ${PASSWORD_MIN_LENGTH} 位` })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: `登录密码最多 ${PASSWORD_MAX_LENGTH} 位` })
  password?: string;
}
