const DEFAULT_WEB_ORIGIN = "http://localhost:3000";
const VERCEL_APP_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

export function getAllowedWebOrigins(): string[] {
  const rawOrigins = process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN;

  return rawOrigins
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function isAllowedWebOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = origin.replace(/\/$/, "");
  return getAllowedWebOrigins().includes(normalizedOrigin) || VERCEL_APP_ORIGIN_PATTERN.test(normalizedOrigin);
}
