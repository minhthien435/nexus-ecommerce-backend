import pg from 'pg';
import argon2 from 'argon2';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

await client.connect();

try {
  // 1. Get role IDs for SELLER and BUYER
  const sellerRoleRes = await client.query("SELECT id FROM identity.roles WHERE code = 'SELLER'");
  if (sellerRoleRes.rows.length === 0) {
    throw new Error("Role SELLER not found in identity.roles");
  }
  const sellerRoleId = sellerRoleRes.rows[0].id;

  const buyerRoleRes = await client.query("SELECT id FROM identity.roles WHERE code = 'BUYER'");
  if (buyerRoleRes.rows.length === 0) {
    throw new Error("Role BUYER not found in identity.roles");
  }
  const buyerRoleId = buyerRoleRes.rows[0].id;

  // 2. Define seller accounts to create/ensure
  const sellers = [
    {
      email: 'seller.test@nexus.vn',
      fullName: 'Nexus Demo Seller',
      password: 'Seller@123456'
    },
    {
      email: 'seller@nexus.vn',
      fullName: 'Nexus Main Seller',
      password: 'Seller@123456'
    }
  ];

  for (const s of sellers) {
    const existing = await client.query("SELECT id FROM identity.users WHERE email = $1", [s.email]);
    let userId;
    const hash = await argon2.hash(s.password);

    if (existing.rows.length === 0) {
      const inserted = await client.query(
        "INSERT INTO identity.users (email, password_hash, full_name, status) VALUES ($1, $2, $3, $4) RETURNING id",
        [s.email, hash, s.fullName, 'ACTIVE']
      );
      userId = inserted.rows[0].id;
      console.log(`Created user ${s.email} with id: ${userId}`);
    } else {
      userId = existing.rows[0].id;
      // Update password to ensure it's Seller@123456 and active
      await client.query("UPDATE identity.users SET password_hash = $1, status = 'ACTIVE' WHERE id = $2", [hash, userId]);
      console.log(`User ${s.email} already exists (id: ${userId}), updated password.`);
    }

    // Assign roles SELLER and BUYER
    await client.query(
      "INSERT INTO identity.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, sellerRoleId]
    );
    await client.query(
      "INSERT INTO identity.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, buyerRoleId]
    );
    console.log(`Assigned SELLER and BUYER roles to ${s.email}`);
  }

  console.log("\nALL SELLER ACCOUNTS CREATED SUCCESSFULLY!");
} catch (err) {
  console.error("Error creating seller account:", err);
} finally {
  await client.end();
}
