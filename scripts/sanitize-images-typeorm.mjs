import 'reflect-metadata';
import dotenv from 'dotenv';
import { DataSource, EntitySchema, Like } from 'typeorm';

dotenv.config();

const ProductImageSchema = new EntitySchema({
  name: 'ProductImageEntity',
  tableName: 'product_images',
  schema: 'catalog',
  columns: {
    id: {
      type: 'uuid',
      primary: true,
      generated: 'uuid',
    },
    productId: {
      type: 'uuid',
      name: 'product_id',
    },
    url: {
      type: 'text',
    },
    sortOrder: {
      type: 'integer',
      name: 'sort_order',
    },
    isPrimary: {
      type: 'boolean',
      name: 'is_primary',
    },
    createdAt: {
      type: 'timestamptz',
      name: 'created_at',
      createDate: true,
    },
  },
});

async function main() {
  console.log('🚀 Đang kết nối Database bằng TypeORM...');
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    entities: [ProductImageSchema],
  });

  await dataSource.initialize();
  console.log('✅ TypeORM DataSource đã kết nối thành công!');

  const repo = dataSource.getRepository(ProductImageSchema);

  // 1. Tìm các ảnh có URL chứa token tạm /images/W/.../images/
  const brokenImages = await repo.find({
    where: {
      url: Like('%/images/W/%'),
    },
  });

  console.log(`🔍 Tìm thấy ${brokenImages.length} ảnh cần được chuẩn hóa URL...`);

  if (brokenImages.length === 0) {
    console.log('✨ Toàn bộ ảnh đã ở trạng thái sạch và chuẩn 200 OK!');
    await dataSource.destroy();
    return;
  }

  // 2. Chuẩn hóa URL bằng cách thay thế cụm token tạm thành /images/
  for (const img of brokenImages) {
    img.url = img.url.replace(/\/images\/W\/[^/]+\/images\//, '/images/');
  }

  // 3. Lưu lại bằng TypeORM Repository (batch save)
  const batchSize = 100;
  for (let i = 0; i < brokenImages.length; i += batchSize) {
    const chunk = brokenImages.slice(i, i + batchSize);
    await repo.save(chunk);
    console.log(` Đã cập nhật xong ${Math.min(i + batchSize, brokenImages.length)} / ${brokenImages.length} ảnh`);
  }

  console.log('🎉 Hoàn tất 100% chuẩn hóa ảnh bằng TypeORM!');
  await dataSource.destroy();
}

main().catch(async (err) => {
  console.error('❌ Lỗi khi thực thi TypeORM script:', err);
  process.exit(1);
});
