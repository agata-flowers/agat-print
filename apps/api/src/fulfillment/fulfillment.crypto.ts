import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Injectable, Inject } from "@nestjs/common";
import type { AppEnvironment } from "../config/environment";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";

const safeEqualHex = (left: string, right: string): boolean => {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right))
    return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
};

@Injectable()
export class FulfillmentCrypto {
  constructor(@Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment) {}

  digest(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  nonce(): string {
    return randomBytes(16).toString("hex");
  }

  token(): string {
    return randomBytes(32).toString("base64url");
  }

  pin(context: "completion" | "handoff", nonce: string): string {
    const bytes = createHmac("sha256", this.env.pickupPinSecret)
      .update(`${context}:${nonce}`)
      .digest();
    return (bytes.readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
  }

  pinDigest(context: "completion" | "handoff", nonce: string, pin: string) {
    return createHmac("sha256", this.env.pickupPinSecret)
      .update(`${context}:${nonce}:${pin}`)
      .digest("hex");
  }

  verifyPin(
    context: "completion" | "handoff",
    nonce: string,
    pin: string,
    digest: string,
  ) {
    return safeEqualHex(this.pinDigest(context, nonce, pin), digest);
  }

  agentDigest(token: string): string {
    return createHmac("sha256", this.env.printerAgentTokenPepper)
      .update(token)
      .digest("hex");
  }

  verifyAgentToken(token: string, digest: string): boolean {
    return safeEqualHex(this.agentDigest(token), digest);
  }

  encryptAddress(value: string) {
    const key = Buffer.from(this.env.deliveryDataKey, "base64");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value.normalize("NFKC"), "utf8"),
      cipher.final(),
    ]);
    return {
      addressCiphertext: ciphertext.toString("base64"),
      addressIv: iv.toString("base64"),
      addressAuthTag: cipher.getAuthTag().toString("base64"),
    };
  }

  decryptAddress(ciphertext: string, iv: string, tag: string): string {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(this.env.deliveryDataKey, "base64"),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
