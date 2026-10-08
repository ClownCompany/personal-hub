// @ts-check
// Guarded `npm run db:migrate:down`; there is deliberately no override flag.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkDatabaseUrl, checkDownArgs } from "./db-migrate-guard.mjs";

const args = process.argv.slice(2);
const checks = [
  checkDatabaseUrl(process.env.DATABASE_URL),
  checkDownArgs(args),
];
const refusal = checks.find((check) => !check.ok);
if (refusal !== undefined && !refusal.ok) {
  console.error(`db:migrate:down refused: ${refusal.message}`);
  process.exit(1);
}

const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js",
    "-f",
    "db/node-pg-migrate.json",
    "down",
    ...args,
  ],
  { cwd: root, stdio: "inherit" },
);
process.exit(result.status ?? 1);
