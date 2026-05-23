import { Injectable } from "@nestjs/common";

@Injectable()
export class AuthService {
  // TODO: Replace this placeholder with a real auth strategy before opening private quiz management.
  getAnonymousUser() {
    return { id: null, displayName: "Anonymous" };
  }
}
