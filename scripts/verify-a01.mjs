import { Client } from 'pg';

const c = new Client({ host: 'localhost', port: 5432, database: 'purelyprofit', user: 'f0rest' });
await c.connect();

const result = await c.query('SELECT id, table_code, status, is_active FROM scan_ordering_tables WHERE table_code = '\''A01'\''');
console.log('✅ A01 状态:', JSON.stringify(result.rows[0]));

await c.end();
