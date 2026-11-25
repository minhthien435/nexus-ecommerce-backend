export const PREFERRED_LANGUAGES = ['vi', 'en'] as const;
export type PreferredLanguage = (typeof PREFERRED_LANGUAGES)[number];
