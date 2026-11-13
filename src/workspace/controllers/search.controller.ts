import { Controller, Get, Header, Query } from '@nestjs/common';
import { User } from '../../auth/decorators/user.decorator';
import { UserWithDepartments } from '../../auth/permission-types';
import { SearchService } from '../services/search.service';

/** Global command-palette search across the caller's visible workspace. */
@Controller('workspace/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'Authorization')
  find(
    @User() user: UserWithDepartments,
    @Query() query: Record<string, unknown>,
  ) {
    return this.search.search(user, query);
  }
}
