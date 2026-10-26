import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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
}
