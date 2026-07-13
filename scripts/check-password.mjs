import bcrypt from 'bcrypt';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: 'postgresql://f0rest@localhost:5432/purelyprofit?schema=public',
});

const { rows } = await pool.query(
  "SELECT id, email, name, password FROM users WHERE email = 'profit_phone_13619654022@purelyprofit.local' LIMIT 1"
);

if (rows.length === 0) {
  console.log('用户不存在');
  await pool.end();
  process.exit(0);
}

const user = rows[0];
console.log('用户:', { id: user.id, email: user.email, name: user.name });

const testPassword = '111111';
const matches = await bcrypt.compare(testPassword, user.password);
console.log(`密码 "${testPassword}" 是否匹配:`, matches);

if (!matches) {
  console.log('\n密码不匹配，正在重置为 111111 ...');
  const newHash = await bcrypt.hash(testPassword, 10);
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, user.id]);
  console.log('密码已重置为:', testPassword);
}

await pool.end();
