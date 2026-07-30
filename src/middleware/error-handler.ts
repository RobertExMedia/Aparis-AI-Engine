import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = request.id;

  if (error instanceof AppError) {
    logger.warn(
      {
        err: error,
        code: error.code,
        statusCode: error.statusCode,
        requestId,
        workspaceId: request.auth?.workspaceId,
      },
      error.message,
    );

    const body: ErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(config.isDev && error.details ? { details: error.details } : {}),
      },
    };

    void reply.status(error.statusCode).send(body);
    return;
  }

  if (error instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: config.isDev ? error.flatten() : undefined,
      },
    };
    void reply.status(400).send(body);
    return;
  }

  const statusCode =
    'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;

  // Validation errors from Fastify schema
  if (statusCode === 400 || (error as FastifyError).validation) {
    void reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
      },
    });
    return;
  }

  logger.error(
    {
      err: error,
      requestId,
      url: request.url,
      method: request.method,
      workspaceId: request.auth?.workspaceId,
    },
    'Unhandled error',
  );

  // Never expose internal error details in production
  void reply.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: config.isDev && error.message
        ? error.message
        : 'An unexpected error occurred',
    },
  });
}
