// @ts-check
// Pure rules shared by the `db:migrate:down` guard (scripts/db-migrate-guard.mjs) and the
// TEST_DATABASE_URL validation (src/lib/test/test-env.ts). Plain `.mjs` so the scripts run
// with plain `node`; keep it free of imports and side effects.

export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const MAX_NAME_BYTES = 63;
// pg-connection-string turns every other query parameter (host, port, user, ...) into a driver option.
const SSL_MODES = new Set([
  "disable",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
  "no-verify",
]);
// The driver re-encodes the whole URL when it sees a `%` that is not a valid escape.
export const INVALID_ESCAPE = /%(?![0-9A-Fa-f]{2})/;
export const UNSAFE_CHARACTERS = /[\s\u0000-\u001f\u007f]/;
const TEST_NAME = /^[A-Za-z0-9_]+_test$/;

/** @param {string} value */
export function hasPostgresScheme(value) {
  return /^postgres(ql)?:\/\//.test(value);
}

/** @param {string} value @returns {URL | null} */
export function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** @param {string} name */
export function isTestDatabaseName(name) {
  return TEST_NAME.test(name) && Buffer.byteLength(name) <= MAX_NAME_BYTES;
}

/**
 * The path name without decoding, or null if it contains `%`, so the checked name is the one the driver uses.
 * @param {URL} url
 * @returns {string | null}
 */
export function getRawDatabaseName(url) {
  return url.pathname.includes("%") ? null : url.pathname.slice(1);
}

/**
 * No fragment and no query parameter except a valid sslmode.
 * @param {string} value the raw URL, because an empty fragment is not visible on the parsed URL
 * @param {URL} url
 */
export function hasOnlyAllowedQuery(value, url) {
  if (value.includes("#")) return false;
  // Valid sslmode values never need escapes.
  if (url.search.includes("%")) return false;
  for (const [key, mode] of url.searchParams) {
    if (key !== "sslmode" || !SSL_MODES.has(mode)) return false;
  }
  return true;
}

// An empty user or port makes the driver fall back to PGUSER or PGPORT.
/** @param {URL} url */
export function hasExplicitUser(url) {
  return url.username !== "";
}

/** @param {URL} url */
export function hasExplicitPort(url) {
  return url.port !== "";
}
