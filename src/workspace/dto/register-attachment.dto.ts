import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Register an object already uploaded through `POST /storage/presign`. */
export class RegisterAttachmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(26_214_400)
  size: number;
}
