import "reflect-metadata";
import "./test-environment";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminBootstrapService } from "../src/admin/admin-bootstrap.service";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const runDatabaseTests = process.env.RUN_DB_E2E === "1";
const origin = "http://localhost:3000";

describe.skipIf(!runDatabaseTests)("foundation e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$transaction([
      prisma.auditEvent.deleteMany(),
      prisma.inboxOperation.deleteMany(),
      prisma.outboxEvent.deleteMany(),
      prisma.processingResult.deleteMany(),
      prisma.processingJob.deleteMany(),
      prisma.uploadSession.deleteMany(),
      prisma.retentionTombstone.deleteMany(),
      prisma.permanentObjectReference.deleteMany(),
      prisma.branch.deleteMany(),
      prisma.partner.deleteMany(),
      prisma.session.deleteMany(),
      prisma.otpChallenge.deleteMany(),
      prisma.userRole.deleteMany(),
      prisma.bootstrapState.deleteMany(),
      prisma.user.deleteMany(),
    ]);
  });

  afterAll(async () => app.close());

  async function csrf(
    agent: ReturnType<typeof request.agent>,
  ): Promise<string> {
    const response = await agent
      .get("/api/v1/auth/csrf")
      .expect(200)
      .expect("Cache-Control", "no-store, private");
    return response.body.csrfToken as string;
  }

  async function login(agent: ReturnType<typeof request.agent>, phone: string) {
    const token = await csrf(agent);
    await agent
      .post("/api/v1/auth/otp/request")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ phone })
      .expect(202);
    const response = await agent
      .post("/api/v1/auth/otp/verify")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ phone, code: "000000", locale: "ru" })
      .expect(201);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(
      cookies.some(
        (value) =>
          value.includes("agat_access=") &&
          value.includes("HttpOnly") &&
          value.includes("SameSite=Lax"),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (value) =>
          value.includes("agat_refresh=") &&
          value.includes("HttpOnly") &&
          value.includes("Path=/api/v1/auth"),
      ),
    ).toBe(true);
    return { csrf: response.body.csrfToken as string, cookies };
  }

  it("registers a customer, rotates a session and rejects refresh reuse", async () => {
    const agent = request.agent(app.getHttpServer());
    const authenticated = await login(agent, "+998901111111");
    await agent.get("/api/v1/profile").expect(200);
    const oldRefresh = authenticated.cookies
      .find((value) => value.startsWith("agat_refresh="))
      ?.split(";")[0];
    await agent
      .post("/api/v1/auth/refresh")
      .set("Origin", origin)
      .set("X-CSRF-Token", authenticated.csrf)
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Origin", origin)
      .set("X-CSRF-Token", authenticated.csrf)
      .set("Cookie", [`agat_csrf=${authenticated.csrf}`, oldRefresh ?? ""])
      .expect(401);
  });

  it("bootstraps one admin and enforces pending partner approval", async () => {
    const customer = request.agent(app.getHttpServer());
    const customerAuth = await login(customer, "+998902222222");
    const created = await customer
      .post("/api/v1/partners")
      .set("Origin", origin)
      .set("X-CSRF-Token", customerAuth.csrf)
      .send({ displayName: "Test Studio", branchName: "Center" })
      .expect(201);
    await customer.get("/api/v1/partners/workspace").expect(403);

    const bootstrap = app.get(AdminBootstrapService);
    await bootstrap.bootstrap("+998903333333");
    await expect(bootstrap.bootstrap("+998904444444")).rejects.toThrow(
      /already/,
    );

    const admin = request.agent(app.getHttpServer());
    const adminAuth = await login(admin, "+998903333333");
    await admin
      .post(`/api/v1/admin/partners/${created.body.id as string}/approve`)
      .set("Origin", origin)
      .set("X-CSRF-Token", adminAuth.csrf)
      .expect(201);
    await customer
      .post("/api/v1/auth/refresh")
      .set("Origin", origin)
      .set("X-CSRF-Token", customerAuth.csrf)
      .expect(201);
    await customer.get("/api/v1/partners/workspace").expect(200);
  });
});
