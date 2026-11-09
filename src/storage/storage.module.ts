import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import {
  STORAGE_DRIVER,
  StorageService,
  createStorageDriver,
} from './storage.service';

@Module({
  controllers: [StorageController],
  providers: [
    {
      provide: STORAGE_DRIVER,
      useFactory: createStorageDriver,
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
