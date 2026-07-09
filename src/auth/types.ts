export interface JwtPayload {
  sub: string; // user id
  email: string;
}

export interface RequestUser {
  id: string;
  email: string;
}
