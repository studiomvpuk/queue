import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Logger } from 'nestjs-pino';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const started = Date.now();
    const { method, url } = req;

    return next.handle().pipe(
      tap({
        next: () =>
          this.logger.log(
            { requestId: req.id, method, url, durationMs: Date.now() - started },
            `${method} ${url} ${Date.now() - started}ms`,
          ),
      }),
    );
  }
}
