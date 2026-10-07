import { BadRequestException } from "@nestjs/common";

/** Marker the frontend checks to swap the repo list for a "paste a new token" form. */
export const GIT_TOKEN_REJECTED = "git_token_rejected";

/**
 * Error for a non-OK GitHub/GitLab API response. A 401 means the saved token
 * itself stopped working (expired, revoked, or its scopes were removed), so
 * retrying can't help — it's tagged so the UI asks for a new token instead.
 * Always a 400 from our API: a 401 here would sign the user out of Audit Bench.
 */
export function gitHostRequestFailed(
  host: "GitHub" | "GitLab",
  status: number,
): BadRequestException {
  if (status === 401) {
    return new BadRequestException({
      statusCode: 400,
      error: "Bad Request",
      message: `${host} rejected your saved token — it has expired or been revoked. Connect a new token to continue.`,
      scope: GIT_TOKEN_REJECTED,
    });
  }
  return new BadRequestException(`${host} rejected the request (${status})`);
}
