import { Inject, Injectable } from "@nestjs/common";
import { Client } from "minio";
import { loadEnvironment, type AppEnvironment } from "../config/environment";

export const APP_ENVIRONMENT = Symbol("APP_ENVIRONMENT");

@Injectable()
export class PrivateObjectStorageService {
  private readonly client: Client;

  constructor(@Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment) {
    const endpoint = new URL(env.minioEndpoint);
    this.client = new Client({
      endPoint: endpoint.hostname,
      port: Number(
        endpoint.port || (endpoint.protocol === "https:" ? 443 : 80),
      ),
      useSSL: endpoint.protocol === "https:",
      accessKey: env.minioAccessKey,
      secretKey: env.minioSecretKey,
    });
  }

  private async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.env.minioBucket);
    if (!exists) {
      if (this.env.nodeEnv === "production")
        throw new Error("Private object bucket is not provisioned");
      await this.client.makeBucket(this.env.minioBucket);
    }
  }

  async putQuarantine(key: string, value: Buffer): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(
      this.env.minioBucket,
      key,
      value,
      value.length,
      { "Content-Type": "application/octet-stream" },
    );
  }

  async promote(sourceKey: string, destinationKey: string): Promise<void> {
    await this.ensureBucket();
    await this.client.copyObject(
      this.env.minioBucket,
      destinationKey,
      `/${this.env.minioBucket}/${sourceKey}`,
    );
  }

  async remove(key: string): Promise<void> {
    await this.ensureBucket();
    await this.client.removeObject(this.env.minioBucket, key);
  }

  async putPermanent(key: string, value: Buffer): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(
      this.env.minioBucket,
      key,
      value,
      value.length,
      { "Content-Type": "application/octet-stream" },
    );
  }

  async putDocument(key: string, value: Buffer): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(
      this.env.minioBucket,
      key,
      value,
      value.length,
      {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store, private",
      },
    );
  }

  async signedGetUrl(key: string, ttlSeconds: number): Promise<string> {
    await this.ensureBucket();
    return this.client.presignedGetObject(
      this.env.minioBucket,
      key,
      ttlSeconds,
      { "response-cache-control": "no-store, private" },
    );
  }

  async get(key: string, maxBytes: number): Promise<Buffer> {
    await this.ensureBucket();
    const stream = await this.client.getObject(this.env.minioBucket, key);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const raw of stream) {
      const chunk = Buffer.from(raw as Uint8Array);
      total += chunk.length;
      if (total > maxBytes) {
        stream.destroy();
        throw new Error("Private object exceeds configured limit");
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureBucket();
    try {
      await this.client.statObject(this.env.minioBucket, key);
      return true;
    } catch {
      return false;
    }
  }

  async ready(): Promise<void> {
    await this.ensureBucket();
  }
}

export const environmentProvider = {
  provide: APP_ENVIRONMENT,
  useFactory: (): AppEnvironment => loadEnvironment(),
};
