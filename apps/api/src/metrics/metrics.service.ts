import { Injectable } from "@nestjs/common";
import { Counter, Registry } from "prom-client";

export const METRIC_LABELS = [
  "route",
  "method",
  "status_code",
  "role",
  "operation",
  "domain_status",
] as const;
const forbidden = /(?:id|phone|ip|url|query|file|token|request)/i;
export const validateMetricLabelNames = (labels: readonly string[]): void => {
  for (const label of labels)
    if (
      !METRIC_LABELS.includes(label as (typeof METRIC_LABELS)[number]) ||
      forbidden.test(label)
    )
      throw new Error(`Unsafe metric label: ${label}`);
};

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests: Counter<"route" | "method" | "status_code">;
  constructor() {
    validateMetricLabelNames(["route", "method", "status_code"]);
    this.httpRequests = new Counter({
      name: "agat_http_requests_total",
      help: "HTTP requests by bounded route template",
      labelNames: ["route", "method", "status_code"],
      registers: [this.registry],
    });
  }
}
