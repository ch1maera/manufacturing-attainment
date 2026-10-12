import type { Request } from 'express';
import { getExecutionContext } from '@databricks/appkit';
import { WorkspaceClient } from '@databricks/sdk-experimental';

/**
 * Build the Authorization header for an outbound Databricks call.
 *
 * Serving (`/serving-endpoints/responses`, MAS) and Genie reject the Apps
 * browser OBO JWT (`x-forwarded-access-token`) with `403 Invalid Token`.
 * AppKit's default WorkspaceClient is also unsafe here: the Apps container
 * has both oauth-m2m env (DATABRICKS_CLIENT_ID/SECRET) and a PAT in
 * ~/.databrickscfg, which surfaces as "more than one authorization method
 * configured: oauth and pat" and can mint a token the Responses API rejects.
 *
 * In a deployed app, pin oauth-m2m with the app service principal's client
 * credentials. Databricks SP JWTs expire in ~1 hour. The SDK caches the
 * token on the WorkspaceClient; if that cache goes stale the Responses API
 * returns `403 Invalid Token`. We treat the JWT `exp` claim as source of
 * truth and mint a new client when the token is within 2 minutes of expiry.
 * Locally, fall back to AppKit's SDK chain (CLI profile).
 * Actor attribution stays on `x-forwarded-email` via `lib/user.ts`.
 *
 * `req` is unused; kept so call sites stay unchanged.
 */
const REFRESH_SKEW_MS = 2 * 60 * 1000;

let appClient: WorkspaceClient | undefined;
let loggedAuthPath = false;

function servingClient(): WorkspaceClient {
  const host = process.env.DATABRICKS_HOST;
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (host && clientId && clientSecret) {
    appClient ??= new WorkspaceClient({
      host,
      clientId,
      clientSecret,
      authType: 'oauth-m2m',
    });
    return appClient;
  }
  return getExecutionContext().client;
}

function jwtExpMs(token: string): number | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const json = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function tokenFrom(headers: Headers): string {
  return (headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
}

export async function authHeaders(
  _req: Request,
  opts?: { forceRefresh?: boolean },
): Promise<Headers> {
  if (opts?.forceRefresh) appClient = undefined;
  const h = new Headers();
  let client = servingClient();
  await client.config.authenticate(h);
  let token = tokenFrom(h);
  const exp = jwtExpMs(token);
  const stale =
    !opts?.forceRefresh &&
    client === appClient &&
    (exp == null || exp - Date.now() < REFRESH_SKEW_MS);
  if (stale) {
    const prevExpInS =
      exp == null ? 'none' : Math.round((exp - Date.now()) / 1000);
    appClient = undefined;
    client = servingClient();
    h.delete('Authorization');
    await client.config.authenticate(h);
    token = tokenFrom(h);
    console.log(`[auth] refreshed oauth-m2m token; prev_exp_in_s=${prevExpInS}`);
  }
  if (!loggedAuthPath) {
    loggedAuthPath = true;
    const path =
      client === appClient ? 'oauth-m2m app SP' : 'AppKit default chain';
    const expInS =
      jwtExpMs(token) == null
        ? 'none'
        : Math.round((jwtExpMs(token)! - Date.now()) / 1000);
    console.log(
      `[auth] outbound Databricks calls use ${path}; token_len=${token.length} jwt=${token.startsWith('eyJ')} exp_in_s=${expInS}`,
    );
  }
  return h;
}
