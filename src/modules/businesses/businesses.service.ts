import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
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
    // Check if email is already taken
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists. Please log in.');
    }

    // Generate slug from business name
    const baseSlug = dto.businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check if slug already exists — append random suffix if needed
    let slug = baseSlug;
    const existingBusiness = await this.prisma.business.findUnique({
      where: { slug },
    });
    if (existingBusiness) {
      slug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;
    }

    // Hash password
    const passwordHash = await argon2.hash(dto.password);

    // Defaults for Individual
    const businessType = dto.size === 'INDIVIDUAL' ? 'SOLE_PROPRIETORSHIP' : dto.type;
    const businessCategory = dto.size === 'INDIVIDUAL' ? 'OTHER' : dto.category;

    // Use a transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Create user with OWNER role
      const user = await tx.user.create({
        data: {
          firstName: dto.businessName, // Use business name as display name for now
          email: dto.email,
          passwordHash,
          role: UserRole.OWNER,
        },
      });

      // Create the business
      const business = await tx.business.create({
        data: {
          name: dto.businessName,
          slug,
          size: dto.size as any,
          type: (businessType || 'OTHER') as any,
          category: (businessCategory || 'OTHER') as any,
          cacNumber: dto.cacNumber,
          contactFirstName: '',
          contactLastName: '',
          contactEmail: dto.email,
          contactPhone: '',
          ownerId: user.id,
        },
      });

      return { user, business };
    });

    await this.audit.record({
      userId: result.user.id,
      action: AuditAction.BUSINESS_CREATED,
      entity: 'Business',
      entityId: result.business.id,
      ip,
      userAgent,
      metadata: { size: dto.size },
    });

    return {
      business: {
        id: result.business.id,
        name: result.business.name,
        slug: result.business.slug,
        size: result.business.size,
      },
      message: 'Account created successfully. You can now log in.',
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
        // Fill required contact fields from the authenticated owner
        contactFirstName: user.firstName || 'Owner',
        contactLastName: '',
        contactEmail: user.email || '',
        contactPhone: user.phone || '',
        ownerId: userId,
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
