import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class SavedLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async saveLocation(
    userId: string,
    locationId: string,
    ip: string,
    userAgent: string,
  ) {
    // Verify location exists
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    // Check max 5 saved locations per user
    const count = await this.prisma.savedLocation.count({
      where: { userId },
    });

    if (count >= 5) {
      throw new BadRequestException(
        'Maximum 5 saved locations allowed',
      );
    }

    // Create or ignore if exists
    const saved = await this.prisma.savedLocation.upsert({
      where: {
        userId_locationId: {
          userId,
          locationId,
        },
      },
      create: {
        userId,
        locationId,
      },
      update: {},
    });

    await this.audit.record({
      userId,
      action: AuditAction.SAVED_LOCATION_ADDED,
      entity: 'SavedLocation',
      entityId: saved.id,
      ip,
      userAgent,
    });

    return saved;
  }

  async unsaveLocation(
    userId: string,
    locationId: string,
    ip: string,
    userAgent: string,
  ) {
    const saved = await this.prisma.savedLocation.findUnique({
      where: {
        userId_locationId: {
          userId,
          locationId,
        },
      },
    });

    if (!saved) {
      throw new NotFoundException('Saved location not found');
    }

    const deleted = await this.prisma.savedLocation.delete({
      where: {
        userId_locationId: {
          userId,
          locationId,
        },
      },
    });

    await this.audit.record({
      userId,
      action: AuditAction.SAVED_LOCATION_REMOVED,
      entity: 'SavedLocation',
      entityId: deleted.id,
      ip,
      userAgent,
    });

    return deleted;
  }

  async getMySavedLocations(userId: string) {
    const saved = await this.prisma.savedLocation.findMany({
      where: { userId },
      include: { location: true },
      orderBy: { createdAt: 'desc' },
    });

    // Add live queue state to each location (simplified: avgServiceSec + ratingAvg)
    return saved.map((s) => ({
      ...s,
      location: {
        ...s.location,
        queueState: {
          avgServiceSec: s.location.avgServiceSec,
          ratingAvg: s.location.ratingAvg,
          ratingCount: s.location.ratingCount,
        },
      },
    }));
  }
}
