import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function isValidSkuAttributes(value: unknown): boolean {
  if (!isPlainObject(value)) return false;

  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, entryValue]) =>
        key.trim().length > 0 &&
        typeof entryValue === 'string' &&
        entryValue.trim().length > 0,
    )
  );
}

export function IsSkuAttributes(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isSkuAttributes',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: isValidSkuAttributes,
        defaultMessage: (_args: ValidationArguments) =>
          'Thuộc tính biến thể phải là object không rỗng với key/value là chuỗi không rỗng',
      },
    });
  };
}
