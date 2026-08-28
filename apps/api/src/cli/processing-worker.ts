import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { ProcessingWorkerService } from "../uploads/processing-worker.service";

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  app.get(ProcessingWorkerService).start();
}

void main();
