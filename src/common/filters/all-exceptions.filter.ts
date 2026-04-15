import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';

export interface ErrorEnvelope {
  statusCode: number;
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
  timestamp: string;
}

/**
 * Uniform error envelope for every failure path in the API.
 *
 * - Never leaks stack traces or internal messages in production
 * - Maps Prisma errors to sane HTTP codes
 * - Always includes requestId for correlation with logs
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    const envelope = this.toEnvelope(exception, req);
    this.logger.error(
      { requestId: envelope.requestId, err: this.serialize(exception) },
      `${req.method} ${req.url} → ${envelope.statusCode} ${envelope.code}`,
    );

    res.status(envelope.statusCode).json(envelope);
  }

  private toEnvelope(exception: unknown, req: Request & { id?: string }): ErrorEnvelope {
    const base = {
      requestId: req.id,
      timestamp: new Date().toISOString(),
    };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const normalized =
        typeof body === 'string'
          ? { message: body }
          : (body as { message?: string | string[]; error?: string });

      return {
        ...base,
        statusCode: status,
        code: (normalized.error ?? this.codeFromStatus(status)).toString().toUpperCase().replace(/\s+/g, '_'),
        message: Array.isArray(normalized.message) ? normalized.message.join('; ') : normalized.message ?? 'Error',
        details: typeof body === 'object' ? (body as Record<string, unknown>).details : undefined,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaKnownError(exception, base);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { ...base, statusCode: 400, code: 'VALIDATION_ERROR', message: 'Invalid query' };
    }

    // Unknown — never leak the actual message in prod
    const isProd = process.env.NODE_ENV === 'production';
    return {
      ...base,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: isProd ? 'Something went wrong' : (exception as Error)?.message ?? 'Internal error',
    };
  }

  private mapPrismaKnownError(
    err: Prisma.PrismaClientKnownRequestError,
    base: { requestId?: string; timestamp: string },
  ): ErrorEnvelope {
    switch (err.code) {
      case 'P2002':
        return { ...base, statusCode: 409, code: 'ALREADY_EXISTS', message: 'Resource already exists' };
      case 'P2025':
        return { ...base, statusCode: 404, code: 'NOT_FOUND', message: 'Resource not found' };
      case 'P2003':
        return { ...base, statusCode: 409, code: 'FK_CONSTRAINT', message: 'Referenced resource missing' };
      default:
        return { ...base, statusCode: 500, code: 'DB_ERROR', message: 'Database error' };
    }
  }

  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE',
      429: 'RATE_LIMITED',
      500: 'INTERNAL_ERROR',
    };
    return map[status] ?? 'ERROR';
  }

  private serialize(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      return { name: err.name, message: err.message, stack: err.stack };
    }
    return { value: String(err) };
  }
}
