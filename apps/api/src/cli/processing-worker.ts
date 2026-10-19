import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { LayoutProcessingWorkerService } from "../layouts/layout-processing-worker.service";
import { ProcessingWorkerService } from "../uploads/processing-worker.service";

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  app.get(ProcessingWorkerService).start();
  app.get(LayoutProcessingWorkerService).start();
}

void main();
