export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_POLICY_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
export const PASSWORD_MIN_LENGTH_MESSAGE = 'Mật khẩu ít nhất 8 ký tự trở lên';
export const PASSWORD_POLICY_MESSAGE =
  'Mật khẩu phải chứa ít nhất 1 chữ hoa, 1 chữ thường, 1 số và 1 ký tự đặc biệt (!@#$%^&*)';
