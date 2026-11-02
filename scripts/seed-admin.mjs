import pg from 'pg';
import argon2 from 'argon2';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

await client.connect();

// 1. Get role ADMIN and BUYER id
const roleRes = await client.query("SELECT id FROM identity.roles WHERE code = 'ADMIN'");
const adminRoleId = roleRes.rows[0].id;
const buyerRoleRes = await client.query("SELECT id FROM identity.roles WHERE code = 'BUYER'");
const buyerRoleId = buyerRoleRes.rows[0].id;

// 2. Assign ADMIN to existing users
const targetEmails = ['hoang.leminh9012k6@gmail.com', 'mlemmlem20252026@gmail.com', 'Jadmin2@gmail.com'];
for (const email of targetEmails) {
  const uRes = await client.query("SELECT id FROM identity.users WHERE email = $1", [email]);
  if (uRes.rows.length > 0) {
    const userId = uRes.rows[0].id;
    await client.query("INSERT INTO identity.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, adminRoleId]);
    console.log("Assigned ADMIN to:", email);
  }
}

// 3. Create or ensure admin@nexus.vn exists with known password Admin@123456
const existingAdmin = await client.query("SELECT id FROM identity.users WHERE email = 'admin@nexus.vn'");
if (existingAdmin.rows.length === 0) {
  const hash = await argon2.hash('Admin@123456');
  const newU = await client.query(
    "INSERT INTO identity.users (email, password_hash, full_name, status) VALUES ($1, $2, $3, $4) RETURNING id",
    ['admin@nexus.vn', hash, 'Nexus System Admin', 'ACTIVE']
  );
  const newId = newU.rows[0].id;
  await client.query("INSERT INTO identity.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [newId, adminRoleId]);
  await client.query("INSERT INTO identity.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [newId, buyerRoleId]);
  console.log("Created admin@nexus.vn successfully");
} else {
  await client.query("INSERT INTO identity.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [existingAdmin.rows[0].id, adminRoleId]);
  console.log("admin@nexus.vn already exists, ensured ADMIN role.");
}

await client.end();
