import { IsEmail, IsString, MinLength } from 'class-validator';

export class SystemLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
