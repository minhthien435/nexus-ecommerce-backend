import { ServiceUnavailableException } from '@nestjs/common';
export function aiUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    errorCode: 'AI_UNAVAILABLE',
    message:
      'Xin lỗi, trợ lý đang tạm bận. Bạn vui lòng thử lại hoặc mở trang tìm kiếm.',
  });
}
