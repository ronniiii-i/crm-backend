import { IsOptional, IsString } from 'class-validator';

export class UpdateTenantLifecycleDto {
  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  trialExpiresAt?: string;

  @IsOptional()
  @IsString()
  gracePeriodEndsAt?: string;
}
