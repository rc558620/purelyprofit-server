import { EmployeeGender } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEmployeeDto } from './create-employee.dto';
import { UpdateEmployeeDto } from './update-employee.dto';

describe('Employee DTO', () => {
  it('CreateEmployeeDto 兼容前端新增员工入参', async () => {
    const dto = plainToInstance(CreateEmployeeDto, {
      name: '小蓝',
      phone: '13112341234',
      position: '销售',
      department: '综合部',
      joinDate: 1778860800000,
      baseSalary: 3000,
      idCard: '53250119940403125X',
      gender: EmployeeGender.male,
      emergencyContact: '高度',
      emergencyPhone: '13422332233',
      contractEndDate: 1810396800000,
    });

    await expect(
      validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).resolves.toEqual([]);
  });

  it('UpdateEmployeeDto 会校验底薪必须为非负数字', async () => {
    const dto = plainToInstance(UpdateEmployeeDto, {
      baseSalary: -1,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toMatchObject({
      min: '底薪不能为负数',
    });
  });
});
