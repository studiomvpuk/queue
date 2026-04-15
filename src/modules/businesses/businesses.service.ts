import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuditAction, UserRole } from '@prisma/client';
import { CreateBusinessDto } from './dto/create-business.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';

@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createBusiness(
    userId: string,
    dto: CreateBusinessDto,
    ip: string,
    userAgent: string,
  ) {
    // Only OWNER can create businesses
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only OWNERs can create businesses');
    }

    const business = await this.prisma.business.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        logoUrl: dto.logoUrl,
      },
    });

    await this.audit.record({
      userId,
      action: AuditAction.BUSINESS_CREATED,
      entity: 'Business',
      entityId: business.id,
      ip,
      userAgent,
    });

    return business;
  }

  async getMyBusinesses(userId: string) {
    // Return businesses where user is OWNER or MANAGER at any location
    const memberships = await this.prisma.staffMembership.findMany({
      where: {
        userId,
        role: { in: [UserRole.OWNER, UserRole.MANAGER] },
      },
      include: {
        location: {
          select: { businessId: true },
        },
      },
    });

    const businessIds = [...new Set(memberships.map((m) => m.location.businessId))];

    const businesses = await this.prisma.business.findMany({
      where: { id: { in: businessIds } },
    });

    return businesses;
  }

  async getBusinessLocations(userId: string, businessId: string) {
    // Verify caller has access to this business
    const membership = await this.prisma.staffMembership.findFirst({
      where: {
        userId,
        location: { businessId },
        role: { in: [UserRole.OWNER, UserRole.MANAGER] },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this business');
    }

    const locations = await this.prisma.location.findMany({
      where: { businessId },
    });

    return locations;
  }

  async getBusinessAggregate(userId: string, businessId: string) {
    // Verify caller has access
    const membership = await this.prisma.staffMembership.findFirst({
      where: {
        userId,
        location: { businessId },
        role: { in: [UserRole.OWNER, UserRole.MANAGER] },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this business');
    }

    // Get all locations in business
    const locations = await this.prisma.location.findMany({
      where: { businessId },
      select: { id: true },
    });

    const locationIds = locations.map((l) => l.id);

    // Today's bookings count
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayBookings = await this.prisma.booking.count({
      where: {
        locationId: { in: locationIds },
        createdAt: { gte: today },
      },
    });

    // Average wait time across locations (avgServiceSec)
    const locationStats = await this.prisma.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true, avgServiceSec: true },
    });

    const avgWaitSeconds =
      locationStats.length > 0
        ? locationStats.reduce((sum, l) => sum + l.avgServiceSec, 0) /
          locationStats.length
        : 0;

    // Top 3 busiest locations (by booking count)
    const topLocations = await this.prisma.booking.groupBy({
      by: ['locationId'],
      where: { locationId: { in: locationIds } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 3,
    });

    const topLocationIds = topLocations.map((t) => t.locationId);
    const topLocationDetails = await this.prisma.location.findMany({
      where: { id: { in: topLocationIds } },
      select: { id: true, name: true },
    });

    const topLocationMap = Object.fromEntries(
      topLocationDetails.map((l) => [l.id, l.name]),
    );

    const topBusiestLocations = topLocations.map((t) => ({
      locationId: t.locationId,
      name: topLocationMap[t.locationId],
      bookingCount: t._count.id,
    }));

    return {
      totalBookingsToday: todayBookings,
      avgWaitSeconds,
      topBusiestLocations,
    };
  }

  async inviteStaff(
    userId: string,
    businessId: string,
    dto: InviteStaffDto,
    ip: string,
    userAgent: string,
  ) {
    // Verify location exists and belongs to business
    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
    });

    if (!location || location.businessId !== businessId) {
      throw new NotFoundException('Location not found in this business');
    }

    // Verify caller is OWNER/MANAGER of this location
    const callerMembership = await this.prisma.staffMembership.findUnique({
      where: {
        userId_locationId: {
          userId,
          locationId: dto.locationId,
        },
      },
    });

    if (!callerMembership || !['OWNER', 'MANAGER'].includes(callerMembership.role)) {
      throw new ForbiddenException(
        'You do not have permission to invite staff',
      );
    }

    // Find or create user by phone
    let targetUser = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    if (!targetUser) {
      // Create new user with phone
      targetUser = await this.prisma.user.create({
        data: {
          phone: dto.phone,
          firstName: 'Staff', // placeholder
          role: UserRole.STAFF,
        },
      });
    }

    // Create or update StaffMembership
    const membership = await this.prisma.staffMembership.upsert({
      where: {
        userId_locationId: {
          userId: targetUser.id,
          locationId: dto.locationId,
        },
      },
      create: {
        userId: targetUser.id,
        locationId: dto.locationId,
        role: dto.role,
      },
      update: {
        role: dto.role,
      },
    });

    await this.audit.record({
      userId,
      action: AuditAction.PERMISSIONS_CHANGED,
      entity: 'StaffMembership',
      entityId: membership.id,
      ip,
      userAgent,
    });

    return membership;
  }
}
