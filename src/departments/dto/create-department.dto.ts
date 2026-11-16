import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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

  /**
   * Department module templates provisioned in the same transaction as the
   * department. Unknown keys are rejected with `400 UNKNOWN_MODULE_TEMPLATE`.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  moduleTemplates?: string[];
}
