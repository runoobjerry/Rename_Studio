import { i18n } from "./index";

export function formatDate(value: Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(i18n.resolvedLanguage, options).format(value);
}
