import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const baseCfg = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectTimeout: 10000,
  charset: 'utf8mb4'
};

const dbName = process.env.DB_NAME;

console.log(`Connecting to ${baseCfg.host}:${baseCfg.port}/${dbName} as ${baseCfg.user} ...`);

try {
  // Pass the database in the connection config — avoids the prepared-statement
  // protocol limitation on MariaDB 5.5 where `USE db` is unsupported.
  const conn = await mysql.createConnection(baseCfg);
  const [rows] = await conn.execute('SELECT 1 AS ok, DATABASE() AS db, VERSION() AS ver');
  console.log('CONNECTED:', JSON.stringify(rows[0]));

  const [tables] = await conn.execute(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
    [dbName]
  );
  console.log(`TABLES (${tables.length}): ${tables.map((t) => t.TABLE_NAME).join(', ')}`);

  await conn.end();
} catch (error) {
  console.error('CONNECT FAILED:', error.code || error.message, '-', error.message);
  process.exit(1);
}
