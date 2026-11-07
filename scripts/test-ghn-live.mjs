// Script test nhanh kết nối trực tiếp tới GHN Sandbox với Token & Shop ID trong .env
import 'dotenv/config';

async function testGhnConnection() {
  const apiUrl = process.env.GHN_API_URL || 'https://dev-online-gateway.ghn.vn/shiip/public-api/v2';
  const token = process.env.GHN_API_TOKEN;
  const shopId = process.env.GHN_SHOP_ID;

  console.log('--- ĐANG KIỂM TRA THÔNG TIN CẤU HÌNH ---');
  console.log('API URL:', apiUrl);
  console.log('API Token:', token ? `${token.substring(0, 8)}...` : 'Chưa có');
  console.log('Shop ID:', shopId);

  if (!token || !shopId) {
    console.error('LỖI: Thiếu GHN_API_TOKEN hoặc GHN_SHOP_ID trong .env');
    return;
  }

  // 1. Kiểm tra thông tin Shop trên GHN
  console.log('\n--- BƯỚC 1: LẤY THÔNG TIN CỬA HÀNG TỪ GHN SANDBOX ---');
  try {
    const shopRes = await fetch(`${apiUrl}/shop/all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Token: token,
      },
      body: JSON.stringify({}),
    });
    const shopData = await shopRes.json();
    console.log('Kết quả kết nối GHN:', shopData.code === 200 ? '✅ THÀNH CÔNG (200 OK)' : `❌ Mã lỗi: ${shopData.code} - ${shopData.message}`);
    if (shopData.data?.shops) {
      console.log('Danh sách cửa hàng của tài khoản:');
      shopData.data.shops.forEach((s) => {
        console.log(`- Shop ID: ${s._id} | Tên: ${s.name} | SĐT: ${s.phone} | Địa chỉ: ${s.address} | District: ${s.district_id} | Ward: ${s.ward_code}`);
        console.log('Chi tiết shop:', JSON.stringify(s, null, 2));
      });
    }
  } catch (err) {
    console.error('Không thể kết nối đến máy chủ GHN:', err.message);
  }

  // 2. Tạo thử 1 đơn vận chuyển mẫu lên GHN
  console.log('\n--- BƯỚC 2: TẠO THỬ 1 ĐƠN HÀNG MẪU LÊN GHN SANDBOX ---');
  const sampleOrder = {
    payment_type_id: 1, // Người gửi trả cước
    required_note: 'CHOXEMHANGKHONGTHU',
    from_name: 'Shop A Minh Nexus',
    from_phone: '0924345717',
    from_address: '123 Đường Lê Lợi, Phường Bến Nghé, Quận 1',
    from_ward_code: '20101',
    from_district_id: 1442,
    to_name: 'Khách hàng Demo Nexus',
    to_phone: '0901234567',
    to_address: '456 Đường Nguyễn Huệ',
    to_ward_code: '20101', // Phường Bến Nghé
    to_district_id: 1442,  // Quận 1, TP.HCM
    weight: 300,
    service_type_id: 2, // Chuẩn / Nhanh
    client_order_code: `TEST-NEXUS-${Date.now()}`,
    items: [
      {
        name: 'Sản phẩm thử nghiệm Nexus Express',
        quantity: 1,
        price: 150000,
        weight: 300,
      },
    ],
  };

  try {
    const orderRes = await fetch(`${apiUrl}/shipping-order/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Token: token,
        ShopId: String(shopId),
      },
      body: JSON.stringify(sampleOrder),
    });

    const orderData = await orderRes.json();
    if (orderData.code === 200 && orderData.data) {
      console.log('🎉 TẠO ĐƠN HÀNG GHN THÀNH CÔNG RỰC RỠ!');
      console.log('Mã vận đơn GHN (Tracking Code):', orderData.data.order_code);
      console.log('Phí giao hàng:', orderData.data.total_fee, 'VND');
      console.log('Thời gian dự kiến giao:', orderData.data.expected_delivery_time);
      console.log('\n👉 Anh có thể mở trang https://khachhang5.ghn.vn để thấy đơn hàng này vừa xuất hiện!');
    } else {
      console.error('❌ GHN từ chối tạo đơn:', orderData.code, orderData.message || orderData.code_message_value);
    }
  } catch (err) {
    console.error('Lỗi khi gọi tạo đơn GHN:', err.message);
  }
}

testGhnConnection();
