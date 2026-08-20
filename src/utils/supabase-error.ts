import { logger } from './logger.js';
import { AppError } from './errors.js';

export type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null;

export function logSupabaseError(context: string, error: SupabaseErrorLike): void {
  logger.error(
    {
      context,
      code: error?.code ?? null,
      message: error?.message ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    },
    context,
  );
}

export function throwSupabaseError(context: string, error: SupabaseErrorLike): never {
  logSupabaseError(context, error);
  throw new AppError(error?.message ?? context, 502, error?.code ?? 'SUPABASE_ERROR', {
    details: error?.details ?? null,
    hint: error?.hint ?? null,
  });
}
