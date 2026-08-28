import { createConnection, type Socket } from "node:net";
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AppEnvironment } from "../config/environment";
import { APP_ENVIRONMENT } from "./private-object-storage.service";
import { UploadPolicyError } from "./upload-policy";

@Injectable()
export class AntivirusService {
  constructor(@Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment) {}

  scan(value: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let response = "";
      const socket: Socket = createConnection({
        host: this.env.clamavHost,
        port: this.env.clamavPort,
      });
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      socket.setTimeout(15_000);
      socket.once("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < value.length; offset += 64 * 1024) {
          const chunk = value.subarray(offset, offset + 64 * 1024);
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
      socket.on("data", (chunk: Buffer) => {
        response += chunk.toString("utf8");
      });
      socket.once("end", () => {
        if (/\bFOUND\b/.test(response))
          finish(new UploadPolicyError("MALWARE_DETECTED"));
        else if (/\bOK\b/.test(response)) finish();
        else
          finish(
            new ServiceUnavailableException({
              code: "ANTIVIRUS_UNAVAILABLE",
            }),
          );
      });
      socket.once("timeout", () =>
        finish(
          new ServiceUnavailableException({ code: "ANTIVIRUS_UNAVAILABLE" }),
        ),
      );
      socket.once("error", () =>
        finish(
          new ServiceUnavailableException({ code: "ANTIVIRUS_UNAVAILABLE" }),
        ),
      );
    });
  }

  async ready(): Promise<void> {
    await this.scan(Buffer.alloc(0));
  }
}
