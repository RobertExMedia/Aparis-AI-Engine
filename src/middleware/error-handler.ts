import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, CreditsExhaustedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

/** Flat error body per API contract: { error, message } */
interface ErrorBody {
  error: string;
  message: string;
  details?: unknown;
  /** Public credits snapshot only — never billing internals. */
  credits?: {
    remaining: number | null;
    used: number;
    limit: number | null;
  };
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = request.id;
  const workspaceId =
    request.auth && 'workspaceId' in request.auth
      ? request.auth.workspaceId
      : undefined;

  if (error instanceof AppError) {
    logger.warn(
      {
        code: error.code,
        statusCode: error.statusCode,
        requestId,
        workspaceId,
      },
      error.message,
    );

    const body: ErrorBody = {
      error: error.code,
      message: error.message,
      ...(config.isDev && error.details ? { details: error.details } : {}),
    };

    if (error instanceof CreditsExhaustedError) {
      body.credits = error.credits;
    }

    void reply.status(error.statusCode).send(body);
    return;
  }

  if (error instanceof ZodError) {
    void reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Validation failed',
      ...(config.isDev ? { details: error.flatten() } : {}),
    } satisfies ErrorBody);
    return;
  }

  const statusCode =
    'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;

  if (statusCode === 429) {
    void reply.status(429).send({
      error: 'RATE_LIMITED',
      message: 'Too many requests. Please try again shortly.',
    });
    return;
  }

  if (statusCode === 400 || (error as FastifyError).validation) {
    void reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request',
    });
    return;
  }

  logger.error(
    {
      err: error,
      requestId,
      url: request.url,
      method: request.method,
      workspaceId,
    },
    'Unhandled error',
  );

  void reply.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).send({
    error: 'INTERNAL_ERROR',
    message: config.isDev && error.message
      ? error.message
      : 'An unexpected error occurred',
  });
}
