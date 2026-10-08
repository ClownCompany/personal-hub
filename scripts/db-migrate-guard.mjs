// @ts-check
// Pure checks for `npm run db:migrate:down`. Results carry fixed messages only:
// they must never echo the URL, host, database name or credentials.

import {
  getRawDatabaseName,
  hasExplicitPort,
  hasExplicitUser,
  hasOnlyAllowedQuery,
  hasPostgresScheme,
  INVALID_ESCAPE,
  isTestDatabaseName,
  LOCAL_HOSTS,
  parseUrl,
  UNSAFE_CHARACTERS,
} from "../src/lib/db-url-rules.mjs";

const DEV_DATABASE = "personal_hub";
const COUNT = /^[1-9][0-9]{0,3}$/;

export const MESSAGES = {
  missing: "DATABASE_URL is not set.",
  invalid:
    "DATABASE_URL must be a postgres:// URL without a fragment or query parameters other than a plain sslmode.",
  remote: "DATABASE_URL must use a local host (localhost, 127.0.0.1 or [::1]).",
  database: "The database name must be personal_hub or end in _test.",
  user: "DATABASE_URL must include a user name (PG* environment variables are not supported).",
  port: "DATABASE_URL must include an explicit port (PG* environment variables are not supported).",
  args: "Only a migration count and --dry-run may be passed.",
};

/** @typedef {{ ok: true } | { ok: false, message: string }} Check */

/** @param {string} message @returns {Check} */
const refuse = (message) => ({ ok: false, message });

/** @param {string} name */
function isAllowedDatabaseName(name) {
  return name === DEV_DATABASE || isTestDatabaseName(name);
}

/**
 * Allows only a local server and the dev or a `_test` database, with an explicit user and port.
 * @param {string | undefined} value
 * @returns {Check}
 */
export function checkDatabaseUrl(value) {
  if (value === undefined || value === "") return refuse(MESSAGES.missing);
  if (
    !hasPostgresScheme(value) ||
    UNSAFE_CHARACTERS.test(value) ||
    INVALID_ESCAPE.test(value)
  ) {
    return refuse(MESSAGES.invalid);
  }
  const url = parseUrl(value);
  if (url === null || !hasOnlyAllowedQuery(value, url)) {
    return refuse(MESSAGES.invalid);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) return refuse(MESSAGES.remote);
  const name = getRawDatabaseName(url);
  if (name === null || !isAllowedDatabaseName(name)) {
    return refuse(MESSAGES.database);
  }
  if (!hasExplicitUser(url)) return refuse(MESSAGES.user);
  if (!hasExplicitPort(url)) return refuse(MESSAGES.port);
  return { ok: true };
}

/**
 * Extra arguments are forwarded to the CLI, so options such as `-d`, `-f` or
 * `--envPath` that could point it at another database are refused.
 * @param {string[]} args
 * @returns {Check}
 */
export function checkDownArgs(args) {
  const counts = args.filter((arg) => COUNT.test(arg));
  const dryRuns = args.filter((arg) => arg === "--dry-run");
  const known = counts.length + dryRuns.length === args.length;
  if (!known || counts.length > 1 || dryRuns.length > 1) {
    return refuse(MESSAGES.args);
  }
  return { ok: true };
}
