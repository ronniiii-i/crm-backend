import { IsArray, IsString } from 'class-validator';

export class UpdateRolePermissionsDto {
  @IsArray()
  grants: Array<{
    moduleKey: string;
    action: 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE';
    granted: boolean;
  }>;
}
