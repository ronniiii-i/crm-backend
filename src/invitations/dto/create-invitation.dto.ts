import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsUUID()
  roleId: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
