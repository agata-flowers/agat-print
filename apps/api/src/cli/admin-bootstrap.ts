import "reflect-metadata";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { normalizePhone } from "../auth/auth.crypto";
import { AdminBootstrapService } from "../admin/admin-bootstrap.service";

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const bootstrap = app.get(AdminBootstrapService);
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const phone = normalizePhone(
      await prompt.question("Production administrator phone (+998XXXXXXXXX): "),
    );
    await bootstrap.bootstrap(phone);
    stdout.write(
      "Production administrator created. Sign in through the configured OTP provider.\n",
    );
  } finally {
    prompt.close();
    await app.close();
  }
}
run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Bootstrap failed"}\n`,
  );
  process.exitCode = 1;
});
