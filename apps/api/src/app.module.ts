import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { RequestErrorFilter, RequestIdMiddleware } from './common/request-id';
import { UxModule } from './ux/ux.module';
import { ComplianceModule } from './compliance/compliance.module';
import { SearchModule } from './search/search.module';
import { validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { PropertiesModule } from './properties/properties.module';
import { StayViewModule } from './stayview/stayview.module';
import { HousekeepingModule } from './housekeeping/housekeeping.module';
import { FolioModule } from './folio/folio.module';
import { CashieringModule } from './cashiering/cashiering.module';
import { NightAuditModule } from './nightaudit/nightaudit.module';
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
import { FilesModule } from './files/files.module';
import { ReservationsModule } from './reservations/reservations.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { ConfigurationModule } from './configuration/configuration.module';
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
    FolioModule,
    CashieringModule,
    NightAuditModule,
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
    FilesModule,
    ReviewsModule,
    CustomersModule,
    FxModule,
    ConfigurationModule,
    ReservationsModule,
    VouchersModule,
    UxModule,
    ComplianceModule,
    SearchModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: RequestErrorFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
