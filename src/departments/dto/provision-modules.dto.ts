import { IsArray, IsString } from 'class-validator';

export class ProvisionModulesDto {
  /**
   * Template keys from `department-module-templates.ts`. Existing keys and
   * paths are skipped so re-sending the same payload is a no-op.
   */
  @IsArray()
  @IsString({ each: true })
  moduleTemplates: string[];
}
