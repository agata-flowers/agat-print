import type { Request } from "express";
import type { AuthenticatedUser } from "./request-user";
export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}
