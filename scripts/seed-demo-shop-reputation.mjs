import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const target = new URL(process.env.DATABASE_URL);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: local ? false : { rejectUnauthorized: false },
});
try {
  await client.connect();
  const { rows } = await client.query(
    `
    SELECT s.id FROM identity.shops s JOIN identity.users u ON u.id = s.seller_id
    WHERE u.email = $1 AND s.deleted_at IS NULL`,
    ['seller.demo@nexus.vn'],
  );
  if (rows.length !== 1)
    throw new Error(
      'Expected one existing seller.demo@nexus.vn shop; seed its account/shop first',
    );
  const result = await client.query(
    `
    UPDATE identity.shops SET reputation_score = GREATEST(reputation_score, 70)
    WHERE id = $1 RETURNING reputation_score`,
    [rows[0].id],
  );
  if (result.rowCount !== 1) throw new Error('Demo shop no longer exists');
  console.log(`Demo shop reputation: ${result.rows[0].reputation_score}`);
} finally {
  await client.end();
}
