import { SetMetadata } from "@nestjs/common";

export const PUBLIC_WEBHOOK = "publicWebhook";
export const PublicWebhook = () => SetMetadata(PUBLIC_WEBHOOK, true);
