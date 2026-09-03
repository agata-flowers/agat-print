import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AdminModule } from "./admin/admin.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { CacheControlInterceptor } from "./common/cache-control.interceptor";
import { CsrfGuard } from "./common/csrf.guard";
import { CommerceModule } from "./commerce/commerce.module";
import { HealthController } from "./health/health.controller";
import { FulfillmentModule } from "./fulfillment/fulfillment.module";
import { LayoutsModule } from "./layouts/layouts.module";
import { MetricsModule } from "./metrics/metrics.module";
import { MatchingModule } from "./matching/matching.module";
import { PartnersModule } from "./partners/partners.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProfileModule } from "./profile/profile.module";
import { UploadsModule } from "./uploads/uploads.module";
import { DisputesModule } from "./disputes/disputes.module";

@Module({
  imports: [
    PrismaModule,
    AdminModule,
    AuditModule,
    AuthModule,
    ProfileModule,
    PartnersModule,
    MetricsModule,
    UploadsModule,
    LayoutsModule,
    CommerceModule,
    MatchingModule,
    FulfillmentModule,
    DisputesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
  ],
})
export class AppModule {}
