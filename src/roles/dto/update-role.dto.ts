import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  rank?: number;

  @IsOptional()
  @IsIn(['TENANT', 'DEPARTMENT', 'TEAM', 'SELF'])
  dataScope?: 'TENANT' | 'DEPARTMENT' | 'TEAM' | 'SELF';

  /** Pass `null` to detach the role from its parent. */
  @IsOptional()
  @IsUUID()
  parentRoleId?: string | null;
}
