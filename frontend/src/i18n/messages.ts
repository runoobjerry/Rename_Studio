import type { TFunction } from "i18next";
import { i18n } from "./index";
import { resolveErrorPresentation, type ErrorPresentationContext, type PresentationError } from "./errorPresentation";

export interface LocalizedMessage {
  key: string;
  values?: Record<string, string | number>;
  error?: Error;
  errorContext?: ErrorPresentationContext;
}

export type NotificationMessage = string | LocalizedMessage | Error | { error: Error; errorContext: ErrorPresentationContext };

export function errorMessage(error: PresentationError, t: TFunction = i18n.t, context?: ErrorPresentationContext): string {
  const presentation = resolveErrorPresentation(error, context);
  return t(presentation.key, presentation.values);
}

export function translateMessage(message: NotificationMessage, t: TFunction): string {
  if (typeof message === "string") return message;
  if (message instanceof Error) return errorMessage(message, t);
  if (!("key" in message)) return errorMessage(message.error, t, message.errorContext);
  return t(message.key, { ...message.values, ...(message.error && { message: errorMessage(message.error, t, message.errorContext) }) });
}
