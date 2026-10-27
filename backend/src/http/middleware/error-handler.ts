import type { ErrorRequestHandler } from 'express';
import { FIELD_MESSAGES } from '@team-plan/shared';
import { isDatabaseUnavailable } from '../../db/errors';
import { AssigneeNotFoundError, NotFoundError } from '../../modules/errors';
import { AppError } from '../errors';
import { redactPath, type Logger } from '../logger';
import { ERROR_MESSAGES, type ErrorCode } from '../messages';

export interface MappedError {
  status: number;
  code: ErrorCode;
  fields?: Record<string, string>;
}

export function mapError(error: unknown): MappedError {
  if (error instanceof NotFoundError) {
    return { status: 404, code: 'NOT_FOUND' };
  }

  if (error instanceof AssigneeNotFoundError) {
    return {
      status: 422,
      code: 'VALIDATION_ERROR',
      fields: { assigneeId: FIELD_MESSAGES.ASSIGNEE_NOT_FOUND },
    };
  }

  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      ...(error.fields === undefined ? {} : { fields: error.fields }),
    };
  }

  const type = (error as { type?: unknown } | null)?.type;

  switch (type) {
    case 'entity.too.large':
      return { status: 413, code: 'PAYLOAD_TOO_LARGE' };
    case 'entity.parse.failed':
      return { status: 400, code: 'BAD_REQUEST' };
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' };
    case 'request.aborted':
    case 'request.size.invalid':
      return { status: 400, code: 'BAD_REQUEST' };
    default:
      break;
  }

  if (isDatabaseUnavailable(error)) {
    return { status: 503, code: 'SERVICE_UNAVAILABLE' };
  }

  return { status: 500, code: 'INTERNAL_ERROR' };
}

/**
 * The only error response writer. It never echoes the thrown message, stack,
 * SQL, database path or parser body; those stay in the local log only.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const mapped = mapError(error);
    const logFields = {
      requestId: res.locals.requestId as string | undefined,
      method: req.method,
      path: redactPath(req.originalUrl),
      status: mapped.status,
      code: mapped.code,
    };

    if (mapped.status >= 500) {
      logger.error('request_error', logFields, error);
    } else {
      logger.info('request_rejected', logFields);
    }

    const payload: {
      error: { code: ErrorCode; message: string; fields?: Record<string, string> };
    } = {
      error: {
        code: mapped.code,
        message: ERROR_MESSAGES[mapped.code],
      },
    };

    if (mapped.fields !== undefined) {
      payload.error.fields = mapped.fields;
    }

    res.status(mapped.status).json(payload);
  };
}
