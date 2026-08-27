import { Controller, Get, Header, Inject } from "@nestjs/common";
import { MetricsService } from "./metrics.service";
@Controller("metrics")
export class MetricsController {
  constructor(
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}
  @Get() @Header("Content-Type", "text/plain; version=0.0.4") get() {
    return this.metrics.registry.metrics();
  }
}
