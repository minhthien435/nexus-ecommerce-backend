export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_POLICY_PATTERN =
  /((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/;
export const PASSWORD_MIN_LENGTH_MESSAGE = 'Mật khẩu ít nhất 8 ký tự trở lên';
export const PASSWORD_POLICY_MESSAGE =
  'Mật khẩu phải chứa ít nhất 1 chữ hoa, 1 chữ thường và 1 số hoặc ký tự đặc biệt';
