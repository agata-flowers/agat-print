import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { RequestWithUser } from "./request-with-user";
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<RequestWithUser>().user,
);
