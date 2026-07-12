import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { PropertiesModule } from './properties/properties.module';
import { InventoryModule } from './inventory/inventory.module';
import { RatesModule } from './rates/rates.module';
import { BookingsModule } from './bookings/bookings.module';
import { DistributionModule } from './distribution/distribution.module';
import { FinanceModule } from './finance/finance.module';
import { StaffModule } from './staff/staff.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    AuthModule,
    PropertiesModule,
    InventoryModule,
    RatesModule,
    BookingsModule,
    DistributionModule,
    FinanceModule,
    StaffModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
