export interface ProviderContext {
  idempotencyKey: string;
  correlationId: string;
}
export interface PaymentWebhookEvent {
  eventId: string;
  paymentReference: string;
  outcome: "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED" | "REFUND_SUCCEEDED";
}
export interface OtpProvider {
  send(phone: string, code: string, context: ProviderContext): Promise<void>;
}
export interface PaymentProvider {
  start(
    orderReference: string,
    amountMinor: bigint,
    currency: "UZS",
    context: ProviderContext,
  ): Promise<{ reference: string }>;
  refund(
    paymentReference: string,
    amountMinor: bigint,
    context: ProviderContext,
  ): Promise<{ reference: string }>;
  confirm(
    paymentReference: string,
    context: ProviderContext,
  ): Promise<{ status: "PENDING" | "SUCCEEDED" | "FAILED" }>;
  status(
    reference: string,
    context: ProviderContext,
  ): Promise<{
    status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
    amountMinor: bigint;
    currency: "UZS";
  }>;
  parseWebhook(
    payload: string,
    signature: string | undefined,
  ): PaymentWebhookEvent | null;
}

export interface FiscalProvider {
  submit(
    operation: {
      type: "SALE" | "REFUND";
      orderReference: string;
      paymentReference: string;
      amountMinor: bigint;
      currency: "UZS";
    },
    context: ProviderContext,
  ): Promise<{ reference: string; receiptReference: string; issuedAt: Date }>;
  status(
    reference: string,
    context: ProviderContext,
  ): Promise<{
    status: "PENDING" | "CONFIRMED" | "FAILED";
  }>;
}

export interface PayoutProvider {
  submitBatch(
    batchReference: string,
    partnerReference: string,
    amountMinor: bigint,
    currency: "UZS",
    context: ProviderContext,
  ): Promise<{ reference: string }>;
  status(
    reference: string,
    context: ProviderContext,
  ): Promise<{
    status: "PENDING" | "SETTLED" | "FAILED";
    amountMinor: bigint;
    currency: "UZS";
  }>;
}
export interface FileStorageProvider {
  createPrivateObjectReference(key: string): Promise<{ key: string }>;
}
export interface AntivirusProvider {
  scan(
    stream: AsyncIterable<Uint8Array>,
    context: ProviderContext,
  ): Promise<{
    verdict: "CLEAN" | "INFECTED";
  }>;
}
export interface IsolatedProcessingProvider {
  normalize(
    input: AsyncIterable<Uint8Array>,
    mediaType:
      | "application/pdf"
      | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      | "image/jpeg"
      | "image/png",
    context: ProviderContext,
  ): Promise<AsyncIterable<Uint8Array>>;
}
export interface NotificationProvider {
  notify(
    userId: string,
    template: string,
    context: ProviderContext,
  ): Promise<void>;
}
export interface MapsProvider {
  geocode(
    query: string,
    context: ProviderContext,
  ): Promise<{ latitude: number; longitude: number }>;
  distanceScore(originCode: string, destinationCode: string): Promise<number>;
}
export interface DeliveryProvider {
  createDelivery(
    orderId: string,
    context: ProviderContext,
  ): Promise<{ reference: string }>;
}

export interface PrinterProvider {
  submit(
    jobReference: string,
    document: AsyncIterable<Uint8Array>,
    context: ProviderContext,
  ): Promise<{ reference: string }>;
}
