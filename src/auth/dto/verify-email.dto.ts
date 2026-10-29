import { IsString, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(2)
  tenantSlug: string;
}
