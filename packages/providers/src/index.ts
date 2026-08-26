export interface ProviderContext {
  idempotencyKey: string;
  correlationId: string;
}
export interface OtpProvider {
  send(phone: string, code: string, context: ProviderContext): Promise<void>;
}
export interface PaymentProvider {
  refund(
    paymentReference: string,
    amountMinor: bigint,
    context: ProviderContext,
  ): Promise<{ reference: string }>;
}
export interface FileStorageProvider {
  createPrivateObjectReference(key: string): Promise<{ key: string }>;
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
}
export interface DeliveryProvider {
  createDelivery(
    orderId: string,
    context: ProviderContext,
  ): Promise<{ reference: string }>;
}
