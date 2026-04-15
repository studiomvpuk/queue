import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface SuccessEnvelope<T> {
  data: T;
  requestId?: string;
  timestamp: string;
}

/**
 * Wrap every successful HTTP response in a uniform envelope.
 * Clients always get `{ data, requestId, timestamp }` — same shape every time.
 * Exception responses use a parallel envelope in AllExceptionsFilter.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T>> {
    if (context.getType() !== 'http') return next.handle() as unknown as Observable<SuccessEnvelope<T>>;
    const req = context.switchToHttp().getRequest();
    return next.handle().pipe(
      map((data) => ({
        data,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
