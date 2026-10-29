import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EmploymentStatus } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** Phase 2: role is assigned by roleId (UUID), not an enum slug. */
  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsEnum(EmploymentStatus)
  status?: EmploymentStatus;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}
