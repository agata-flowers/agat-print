import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import type { Request, Response, NextFunction } from "express";
import { AppModule } from "./app.module";
import { loadEnvironment } from "./config/environment";

async function bootstrap(): Promise<void> {
  const env = loadEnvironment();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin: env.webOrigin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  app.use(cookieParser());
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader(
      "X-Request-Id",
      request.headers["x-request-id"] ?? randomUUID(),
    );
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("AGAT PRINT API")
      .setVersion("0.1.0")
      .build(),
  );
  SwaggerModule.setup("api/docs", app, document, {
    customSiteTitle: "AGAT PRINT API",
  });
  await app.listen(env.port, "0.0.0.0");
}
void bootstrap();
