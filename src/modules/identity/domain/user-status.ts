export const USER_STATUSES = ['ACTIVE', 'LOCKED', 'SUSPENDED'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];
