import { env } from "../config/env.js";
import logger from "../utils/logger.js";
import { saveTokens, loadTokens, type TokenData } from "./token-store.js";

const AUTHORITY = `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}`;
const DEVICE_CODE_ENDPOINT = `${AUTHORITY}/oauth2/v2.0/devicecode`;
const TOKEN_ENDPOINT = `${AUTHORITY}/oauth2/v2.0/token`;
const SCOPE = "Mail.ReadWrite User.Read offline_access";
const FIVE_MINUTES_MS = 5 * 60 * 1000;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface ErrorResponse {
  error: string;
  error_description: string;
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    scope: SCOPE,
  });

  const response = await fetch(DEVICE_CODE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(`Failed to request device code: ${error.error_description}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

async function pollForToken(
  deviceCode: string,
  intervalSeconds: number,
): Promise<TokenResponse> {
  let interval = intervalSeconds;

  while (true) {
    await new Promise<void>((resolve) => setTimeout(resolve, interval * 1000));

    const params = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: env.MICROSOFT_CLIENT_ID,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = (await response.json()) as TokenResponse | ErrorResponse;

    if (response.ok) {
      return data as TokenResponse;
    }

    const errorData = data as ErrorResponse;

    switch (errorData.error) {
      case "authorization_pending":
        logger.debug("Authorization pending, continuing to poll");
        continue;

      case "slow_down":
        interval += 5;
        logger.debug({ interval }, "Slow down requested, increasing polling interval");
        continue;

      case "authorization_declined":
        throw new Error("Authorization declined by user");

      case "expired_token":
        throw new Error("Device code expired. Run the auth command again.");

      default:
        throw new Error(
          `Unexpected error during token polling: ${errorData.error_description}`,
        );
    }
  }
}

function tokenResponseToTokenData(response: TokenResponse): TokenData {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
    tokenType: response.token_type,
    scope: response.scope,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.MICROSOFT_CLIENT_ID,
    scope: SCOPE,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    logger.warn({ error: error.error }, "Refresh token rejected, re-authenticating");
    return authenticate();
  }

  const tokenResponse = (await response.json()) as TokenResponse;
  const tokenData = tokenResponseToTokenData(tokenResponse);
  await saveTokens(tokenData);

  logger.info(
    { expiresAt: new Date(tokenData.expiresAt).toISOString() },
    "Token refreshed successfully",
  );

  return tokenData.accessToken;
}

export async function authenticate(): Promise<string> {
  logger.info("Starting Device Code Flow authentication");

  const deviceCodeResponse = await requestDeviceCode();

  console.log(`\nPara autenticar, acesse: ${deviceCodeResponse.verification_uri}`);
  console.log(`Digite o código: ${deviceCodeResponse.user_code}`);
  console.log("Aguardando autenticação...");

  const tokenResponse = await pollForToken(
    deviceCodeResponse.device_code,
    deviceCodeResponse.interval,
  );

  const tokenData = tokenResponseToTokenData(tokenResponse);
  await saveTokens(tokenData);

  const expiresAt = new Date(tokenData.expiresAt).toISOString();
  console.log(`Autenticado com sucesso. Token válido até ${expiresAt}`);

  logger.info({ expiresAt }, "Authentication successful");

  return tokenData.accessToken;
}

export async function getValidAccessToken(): Promise<string> {
  const tokens = await loadTokens();

  if (!tokens) {
    logger.info("No saved tokens found, starting authentication");
    return authenticate();
  }

  const isValid = tokens.expiresAt - FIVE_MINUTES_MS > Date.now();

  if (isValid) {
    logger.debug("Using existing valid access token");
    return tokens.accessToken;
  }

  logger.info("Access token expired, refreshing via refresh token");

  try {
    return await refreshAccessToken(tokens.refreshToken);
  } catch (err) {
    logger.warn({ err }, "Error refreshing token, re-authenticating");
    return authenticate();
  }
}
