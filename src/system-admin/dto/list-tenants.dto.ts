import { IsOptional, IsString } from 'class-validator';

export class ListTenantsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
