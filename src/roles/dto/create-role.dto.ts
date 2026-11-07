import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

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

  /** Optional parent role; the parent must be less privileged. */
  @IsOptional()
  @IsUUID()
  parentRoleId?: string | null;
}
