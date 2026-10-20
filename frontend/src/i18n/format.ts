import { i18n } from "./index";
import { fallbackLanguage } from "./languages";

export function formatDate(value: Date, options?: Intl.DateTimeFormatOptions, locale = i18n.resolvedLanguage ?? fallbackLanguage): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(i18n.resolvedLanguage ?? fallbackLanguage, options).format(value);
}
