import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string; // user id
  email: string;
}

export interface RequestUser {
  id: string;
  email: string;
  // Read fresh from the DB on every request (see JwtStrategy.validate) rather
  // than trusted from the JWT payload, so a role change takes effect on the
  // user's very next request instead of waiting for their token to expire.
  role: Role;
}
