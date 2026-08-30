export const USER_ROLES = ["CUSTOMER", "PARTNER", "COURIER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PARTNER_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const LAYOUT_STATUSES = [
  "PROCESSING",
  "QUALITY_CHECK_FAILED",
  "MANUAL_REVIEW_REQUIRED",
  "AWAITING_APPROVAL",
  "APPROVED",
] as const;
export type LayoutStatus = (typeof LAYOUT_STATUSES)[number];

export const FUTURE_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
] as const;

export const ORDER_STATUSES = [
  "DRAFT",
  "FILE_PROCESSING",
  "QUALITY_CHECK_FAILED",
  "MANUAL_REVIEW_REQUIRED",
  "CLARIFICATION_REQUIRED",
  "PROCESSING_FAILED",
  "AWAITING_LAYOUT_APPROVAL",
  "AWAITING_PAYMENT",
  "PAID",
  "MATCHING",
  "PARTNER_OFFERED",
  "REASSIGNING",
  "PARTNER_ACCEPTED",
  "IN_PRODUCTION",
  "READY",
  "AWAITING_PICKUP",
  "COURIER_ASSIGNED",
  "IN_DELIVERY",
  "DELIVERY_FAILED",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
  "REPRINT",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "REFUND_PENDING",
  "REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface CurrentUser {
  id: string;
  roles: UserRole[];
  locale: "ru" | "uz" | "en";
}

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
}
