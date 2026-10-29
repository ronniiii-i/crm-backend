import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * Stable key used by modules and permission defaults. Optional: when the
   * caller omits it the service derives one from `name`.
   */
  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  sortOrder?: number;
}
