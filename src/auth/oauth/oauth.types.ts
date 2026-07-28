export type OAuthProvider = "github" | "gitlab" | "google";

export interface OAuthProfile {
  providerUserId: string;
  username: string;
  email: string | null;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Null for a token that doesn't expire (GitHub's classic OAuth App tokens). */
  expiresAt: Date | null;
}
