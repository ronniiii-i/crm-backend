import { IsNotEmpty, IsString } from 'class-validator';

export class FinalizeAvatarDto {
  @IsString()
  @IsNotEmpty()
  key: string;
}
