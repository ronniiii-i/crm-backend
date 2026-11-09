import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class PresignUploadDto {
  @IsIn(['avatar', 'attachment'])
  purpose: 'avatar' | 'attachment';

  @IsString()
  @IsNotEmpty()
  contentType: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(26_214_400)
  size: number;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;
}
