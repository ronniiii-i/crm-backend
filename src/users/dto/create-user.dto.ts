import {
  IsEmail,
  IsString,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsString()
  name: string;

  /** Phase 2: role is assigned by roleId (UUID), not an enum. */
  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
