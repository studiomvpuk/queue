import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuditAction, UserRole } from '@prisma/client';
import { CreateBusinessDto } from './dto/create-business.dto';
import { RegisterBusinessDto } from './dto/register-business.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';

@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Public business registration — no auth required.
   * Creates a user (or finds existing by email/phone), promotes to OWNER,
   * and creates the business record.
   */
  async registerBusiness(dto: RegisterBusinessDto, ip: string, userAgent: string) {
    // Generate slug from business name
    const baseSlug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check if slug already exists
    const existingBusiness = await this.prisma.business.findUnique({
      where: { slug: baseSlug },
    });
    if (existingBusiness) {
      throw new ConflictException('A business with a similar name already exists. Please choose a different name.');
    }

    // Find or create the contact person as a user
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.contactEmail },
          { phone: dto.contactPhone },
        ],
      },
    });

    if (user && user.role === UserRole.OWNER) {
      // Check if this owner already has a business (Phase 1: one business per owner)
      const existingOwnerBusiness = await this.prisma.business.findFirst({
        where: { ownerId: user.id },
      });
      if (existingOwnerBusiness) {
        throw new ConflictException('This account already owns a business. Please log in to manage it.');
      }
    }

    // Use a transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      if (!user) {
        // Create new user with OWNER role
        user = await tx.user.create({
          data: {
            firstName: dto.contactFirstName,
            email: dto.contactEmail,
            phone: dto.contactPhone,
            role: UserRole.OWNER,
          },
        });
      } else {
        // Promote existing user to OWNER if they're a CUSTOMER
        if (user.role === UserRole.CUSTOMER) {
          user = await tx.user.update({
            where: { id: user.id },
            data: {
              role: UserRole.OWNER,
              firstName: user.firstName || dto.contactFirstName,
            },
          });
        }
      }

      // Create the business
      const business = await tx.business.create({
        data: {
          name: dto.name,
          slug: baseSlug,
          size: dto.size as any,
          type: dto.type as any,
          category: dto.category as any,
          description: dto.description,
          cacNumber: dto.cacNumber,
          tinNumber: dto.tinNumber,
          contactFirstName: dto.contactFirstName,
          contactLastName: dto.contactLastName,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone,
          contactRole: dto.contactRole,
          businessEmail: dto.businessEmail,
          businessPhone: dto.businessPhone,
          website: dto.website,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          ownerId: user!.id,
        },
      });

      return { user: user!, business };
    });

    // Audit the registration
    await this.audit.record({
      userId: result.user.id,
      action: AuditAction.BUSINESS_CREATED,
      entity: 'Business',
      entityId: result.business.id,
      ip,
      userAgent,
      metadata: { size: dto.size, type: dto.type, category: dto.category },
    });

    return {
      business: result.business,
      message: 'Business registered successfully. Your account is pending verification.',
    };
  }

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
