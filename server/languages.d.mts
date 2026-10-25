export type WorkerLocaleCode = 'en' | 'ar' | 'hi' | 'ur' | 'bn' | 'ml' | 'ta' | 'te' | 'ne' | 'fil' | 'si' | 'ru' | 'pa-Guru' | 'pa-Arab' | 'id';
export type LanguageDirection = 'ltr' | 'rtl';
export interface WorkerLocale {
  readonly code: WorkerLocaleCode;
  readonly base: string;
  readonly name: string;
  readonly englishName: string;
  readonly direction: LanguageDirection;
  readonly script: string;
}
export interface LanguageCapability {
  readonly ui: boolean;
  readonly translation: boolean;
  readonly transcription: boolean;
  readonly speech: boolean;
  readonly assessment: boolean;
}
export declare const WORKER_LOCALES: readonly WorkerLocale[];
export declare const WORKER_LANGUAGE_CODES: readonly WorkerLocaleCode[];
export declare const RTL_LANGUAGE_CODES: readonly WorkerLocaleCode[];
export declare function workerLocale(code: string): WorkerLocale | null;
export declare function isWorkerLanguage(code: unknown): code is WorkerLocaleCode;
export declare function languageDirection(code: string): LanguageDirection | null;
export declare function sqlLanguageList(): string;
export declare const LANGUAGE_CAPABILITIES: Readonly<Record<WorkerLocaleCode, LanguageCapability>>;
export declare function languageCapability(code: string, stage: keyof LanguageCapability): boolean;
export declare const UI_LANGUAGE_CODES: readonly WorkerLocaleCode[];
export declare const CONTENT_LANGUAGE_CODES: readonly WorkerLocaleCode[];
export declare const TRANSCRIPTION_LANGUAGE_CODES: readonly WorkerLocaleCode[];
export declare const SPEECH_LANGUAGE_CODES: readonly WorkerLocaleCode[];
export declare const ASSESSMENT_LANGUAGE_CODES: readonly WorkerLocaleCode[];
export declare const SOURCE_LANGUAGE_CODES: readonly ('en' | 'ar')[];
export declare const STAFF_LANGUAGE_CODES: readonly ('en' | 'ar')[];
