export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = 'Your session has expired. Please sign in again.',
  ) {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have permission to use this agent.',
  ) {
    super(message, 403, 'FORBIDDEN');
  }
}

export class AgentNotFoundError extends AppError {
  constructor(message = 'This agent could not be found.') {
    super(message, 404, 'AGENT_NOT_FOUND');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class AgentUnavailableError extends AppError {
  constructor(message = 'This agent is not currently available.') {
    super(message, 409, 'AGENT_UNAVAILABLE');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please try again shortly.') {
    super(message, 429, 'RATE_LIMITED');
  }
}

export class AiUnavailableError extends AppError {
  constructor(
    message = 'The AI service is temporarily unavailable. Please try again shortly.',
  ) {
    super(message, 503, 'AI_UNAVAILABLE');
  }
}

export class ProviderError extends AiUnavailableError {
  constructor(message = 'The AI service is temporarily unavailable. Please try again shortly.') {
    super(message);
  }
}

export class WorkspaceMismatchError extends ForbiddenError {
  constructor(message = 'You do not have permission to use this agent.') {
    super(message);
  }
}
