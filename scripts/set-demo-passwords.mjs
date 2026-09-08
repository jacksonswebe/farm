/**
 * Sets a real argon2id hash on the seeded demo users.
 *
 * db/seed.sql carries a placeholder because a hash is not portable SQL —
 * it must be produced by the same argon2 parameters the app verifies with.
 * Run after seeding, for local and demo environments only.
 */
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo!2345';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');
if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEMO_PASSWORDS) {
  throw new Error('Refusing to set demo passwords in production.');
}

const digest = await hash(PASSWORD, { memoryCost: 65536, timeCost: 3, parallelism: 4 });
const client = new pg.Client({ connectionString: url });
await client.connect();
const { rowCount } = await client.query(
  `UPDATE users SET password_hash = $1 WHERE email LIKE '%@demo.safesphere.app'`,
  [digest],
);
await client.end();
console.log(`Set the demo password on ${rowCount} user(s).`);
