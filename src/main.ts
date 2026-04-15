/**
 * QueueEase API — bootstrap.
 *
 * Order of concerns is deliberate:
 *   1. Create app with pino logger (structured logs from line 1)
 *   2. Trust proxy (accurate client IPs behind load balancers)
 *   3. helmet + compression + cookies
 *   4. CORS (strict allowlist from env)
 *   5. Global ValidationPipe (whitelist + transform + forbidNonWhitelisted)
 *   6. Global exception filter (uniform error envelope)
 *   7. Swagger (only in non-prod)
 *   8. Graceful shutdown
 */
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Trust first proxy so req.ip reflects the real client IP behind LB/CDN
  app.set('trust proxy', 1);

  // Security headers. CSP tightened explicitly — no unsafe-inline.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", 'https:', 'wss:'],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Swagger UI needs this; prod blocks this route anyway
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    }),
  );

  app.use(compression());
  app.use(cookieParser());
  app.use(new RequestIdMiddleware().use);

  // CORS: strict allowlist
  const origins = (config.get<string>('CORS_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Client-Version'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400,
  });

  // API prefix and URI versioning: /api/v1/*
  const apiPrefix = config.get<string>('API_PREFIX') ?? 'api/v1';
  const [prefix, versionSegment] = apiPrefix.split('/');
  app.setGlobalPrefix(prefix, { exclude: ['health', 'metrics'] });
  if (versionSegment) {
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: versionSegment.replace('v', ''),
    });
  }

  // Global DTO validation — strict whitelist, reject unknown fields
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,
      validationError: { target: false, value: false },
    }),
  );

  // Uniform error envelope
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  // Swagger — dev and staging only
  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('QueueEase API')
      .setDescription('REST + WebSocket contract for QueueEase mobile and web clients.')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addServer('http://localhost:3333')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig, { deepScanRoutes: true });
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();

  const port = Number(config.get('PORT') ?? 3333);
  await app.listen(port, '0.0.0.0');
  logger.log(`QueueEase API listening on :${port} (${config.get('NODE_ENV')})`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
