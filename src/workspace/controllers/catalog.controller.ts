import { Controller, Get } from '@nestjs/common';
import { EntityRegistryService } from '../services/entity-registry.service';

/**
 * Entity/field catalogue for the dashboard and form builders.
 *
 * Read-only metadata with no tenant data: available to any authenticated
 * user. The registry is the same allowlist the write services enforce.
 */
@Controller('workspace')
export class CatalogController {
  constructor(private readonly registry: EntityRegistryService) {}

  @Get('entity-catalog')
  catalog() {
    const catalog = this.registry.catalog();

    return {
      ...catalog,
      aggregations: ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'],
      timeframes: [
        'LAST_7_DAYS',
        'LAST_30_DAYS',
        'LAST_90_DAYS',
        'MTD',
        'QTD',
        'YTD',
        'ALL',
      ],
      widgetKinds: ['stat', 'bar', 'line', 'pie'],
    };
  }
}
