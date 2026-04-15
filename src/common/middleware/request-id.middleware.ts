import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Attach a requestId to every request (honouring an incoming X-Request-Id
 * so we can correlate across services). Echoed back in the response header.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use = (req: Request & { id?: string }, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    req.id = incoming && /^[\w-]{8,128}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}
