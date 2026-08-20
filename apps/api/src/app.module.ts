import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { PropertiesModule } from './properties/properties.module';
import { StayViewModule } from './stayview/stayview.module';
import { HousekeepingModule } from './housekeeping/housekeeping.module';
import { InventoryModule } from './inventory/inventory.module';
import { RatesModule } from './rates/rates.module';
import { BookingsModule } from './bookings/bookings.module';
import { DistributionModule } from './distribution/distribution.module';
import { FinanceModule } from './finance/finance.module';
import { StaffModule } from './staff/staff.module';
import { CommercialModule } from './commercial/commercial.module';
import { CommsModule } from './comms/comms.module';
import { OtaModule } from './ota/ota.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReviewsModule } from './reviews/reviews.module';
import { CustomersModule } from './customers/customers.module';
import { FxModule } from './fx/fx.module';
import { EmailModule } from './email/email.module';
import { ProfileModule } from './profile/profile.module';
import { MediaModule } from './media/media.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    AuthModule,
    BillingModule,
    PropertiesModule,
    InventoryModule,
    StayViewModule,
    HousekeepingModule,
    RatesModule,
    BookingsModule,
    DistributionModule,
    FinanceModule,
    StaffModule,
    CommercialModule,
    CommsModule,
    OtaModule,
    DashboardModule,
    EmailModule,
    ProfileModule,
    MediaModule,
    ReviewsModule,
    CustomersModule,
    FxModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
