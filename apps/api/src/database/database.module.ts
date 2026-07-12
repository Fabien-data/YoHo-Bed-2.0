import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/** Global so any feature module can inject DatabaseService without re-importing. */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
