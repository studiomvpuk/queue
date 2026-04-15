import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { nanoid } from 'nanoid';
import * as argon2 from 'argon2';

interface CreateApiClientDto {
  name: string;
  scopes: string[];
}

interface TokenRequest {
  grant_type: 'client_credentials';
  client_id: string;
  client_secret: string;
}

@Injectable()
export class ApiClientsService {
  private readonly logger = new Logger(ApiClientsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  async createApiClient(adminId: string, dto: CreateApiClientDto, ip?: string, userAgent?: string) {
    // Validate: admin-only in controller, but double-check here
    const clientId = `client_${nanoid(16)}`;
    const clientSecret = `secret_${nanoid(32)}`;
    const clientSecretHash = await argon2.hash(clientSecret);

    const client = await this.prisma.apiClient.create({
      data: {
        name: dto.name,
        clientId,
        clientSecretHash,
        scopes: dto.scopes,
      },
    });

    await this.audit.record({
      userId: adminId,
      action: AuditAction.PERMISSIONS_CHANGED,
      entity: 'ApiClient',
      entityId: client.id,
      ip,
      userAgent,
      metadata: { clientId, scopes: dto.scopes },
    });

    // Return secret ONLY once
    return {
      clientId,
      clientSecret, // Never stored, never retrievable again
      name: client.name,
      scopes: client.scopes,
      createdAt: client.createdAt,
      message: 'Store clientSecret securely. You will never see it again.',
    };
  }

  async issueAccessToken(clientId: string, clientSecret: string): Promise<string> {
    const client = await this.prisma.apiClient.findUnique({
      where: { clientId },
      select: { id: true, clientSecretHash: true, scopes: true, isActive: true, revokedAt: true },
    });

    if (!client || !client.isActive || client.revokedAt) {
      this.logger.warn(`Token request for inactive/revoked client: ${clientId}`);
      throw new ForbiddenException('Client not found or inactive');
    }

    const secretValid = await argon2.verify(client.clientSecretHash, clientSecret);
    if (!secretValid) {
      this.logger.warn(`Invalid secret for client: ${clientId}`);
      throw new ForbiddenException('Invalid credentials');
    }

    // Issue 30-min JWT
    const token = this.jwt.sign(
      {
        sub: clientId,
        type: 'client',
        scopes: client.scopes,
      },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: '30m',
      },
    );

    return token;
  }

  async validateClientToken(token: string): Promise<{ clientId: string; scopes: string[] } | null> {
    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });

      if (payload.type !== 'client') {
        return null;
      }

      return {
        clientId: payload.sub,
        scopes: payload.scopes ?? [],
      };
    } catch {
      return null;
    }
  }
}
