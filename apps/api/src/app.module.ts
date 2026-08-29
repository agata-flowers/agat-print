import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AdminModule } from "./admin/admin.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { CacheControlInterceptor } from "./common/cache-control.interceptor";
import { CsrfGuard } from "./common/csrf.guard";
import { HealthController } from "./health/health.controller";
import { LayoutsModule } from "./layouts/layouts.module";
import { MetricsModule } from "./metrics/metrics.module";
import { PartnersModule } from "./partners/partners.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProfileModule } from "./profile/profile.module";
import { UploadsModule } from "./uploads/uploads.module";

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
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
  ],
})
export class AppModule {}
