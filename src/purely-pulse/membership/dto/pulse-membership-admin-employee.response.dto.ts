import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * Pulse 管理端：门店在职员工候选列表项
 * 用于子账号槽位分配时的员工选择下拉
 */
export class PulseAdminEmployeeCandidateDto {
  @ApiProperty({ example: '18', description: '员工 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '张三', description: '员工姓名' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '店长', description: '职位名称' })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({ example: '前厅', description: '部门名称' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiProperty({ example: true, description: '是否已分配子账号槽位' })
  @IsBoolean()
  hasSubAccount: boolean;

  @ApiPropertyOptional({
    example: 2,
    description: '已分配的槽位序号（若无则为空）',
  })
  @IsOptional()
  @IsInt()
  assignedSlotIndex?: number;
}

/**
 * Pulse 管理端：门店在职员工候选列表响应
 */
export class PulseAdminEmployeeCandidatesResponseDto {
  @ApiProperty({
    type: [PulseAdminEmployeeCandidateDto],
    description: '在职员工候选列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminEmployeeCandidateDto)
  items: PulseAdminEmployeeCandidateDto[];
}
