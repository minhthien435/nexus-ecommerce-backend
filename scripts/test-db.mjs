import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

async function testConnection() {
  console.log('Đang kiểm tra cấu hình kết nối từ .env...');
  
  const host = process.env.DB_HOST;
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  const user = process.env.DB_USERNAME || 'postgres';
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_DATABASE || 'postgres';

  if (!password || password === 'YOUR_DB_PASSWORD_HERE') {
    console.error('\n LỖI: Bạn chưa điền mật khẩu Database vào file .env!');
    console.error(' Hãy mở file .env và thay YOUR_DB_PASSWORD_HERE bằng mật khẩu database Supabase của bạn.');
    console.error(' Sau đó chạy lại: node scripts/test-db.mjs\n');
    process.exit(1);
  }

  console.log(` Đang kết nối tới Supabase: ${host}:${port} (Database: ${database}, User: ${user})...`);

  const client = new Client({
    host,
    port,
    user,
    password,
    database,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    console.log(' KẾT NỐI DATABASE THÀNH CÔNG RỰC RỠ!\n');

    // 1. Kiểm tra thông tin phiên bản
    const resVersion = await client.query('SELECT version();');
    console.log(` PostgreSQL Version: ${resVersion.rows[0].version}`);

    // 2. Kiểm tra các schema của Nexus E-Commerce
    const resSchemas = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name IN ('identity', 'catalog', 'commerce', 'auction', 'fulfillment', 'notification')
      ORDER BY schema_name;
    `);
    
    console.log('\n Các Bounded Context Schemas tìm thấy:');
    for (const row of resSchemas.rows) {
      const tableCount = await client.query(`
        SELECT count(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = $1;
      `, [row.schema_name]);
      console.log(`   - Schema [${row.schema_name}]: ${tableCount.rows[0].count} bảng`);
    }
  } catch (error) {
    console.error('\n KẾT NỐI THẤT BÀI:', error.message);
    if (error.message.includes('password authentication failed')) {
      console.error(' Mật khẩu trong .env không chính xác. Vui lòng kiểm tra lại mật khẩu Supabase.');
    } else if (error.message.includes('getaddrinfo')) {
      console.error(' Không phân giải được host Supabase. Kiểm tra lại kết nối mạng hoặc DB_HOST.');
    }
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

testConnection();
