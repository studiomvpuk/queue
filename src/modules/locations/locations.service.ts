import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { Location, LocationCategory, UserRole, AuditAction, Booking, BookingStatus } from '@prisma/client';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { AttachStaffDto } from './dto/attach-staff.dto';

export interface LocationWithQueue extends Location {
  liveQueueCount: number;
  avgWaitMinutes: number;
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Public: Get all locations with optional filters and cursor pagination.
   */
  async list(
    category?: LocationCategory,
    nearLat?: number,
    nearLng?: number,
    radiusKm?: number,
    search?: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ locations: LocationWithQueue[]; nextCursor: string | null }> {
    const take = limit + 1; // Fetch one extra to determine if more exist

    const where: any = { isActive: true, deletedAt: null };

    if (category) {
      where.category = category;
    }

    if (search) {
      where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { address: { contains: search, mode: 'insensitive' } }];
    }

    const locations = await this.prisma.location.findMany({
      where,
      take,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { createdAt: 'desc' },
    });

    // Filter by distance if coordinates provided
    let filtered = locations;
    if (nearLat !== undefined && nearLng !== undefined && radiusKm !== undefined) {
      filtered = this.filterByDistance(locations, nearLat, nearLng, radiusKm);
    }

    const hasMore = filtered.length > limit;
    const result = hasMore ? filtered.slice(0, limit) : filtered;

    // Batch-enrich (one groupBy + one query) — avoids N+1 across the page.
    const enriched = await this.enrichManyWithQueue(result);

    return {
      locations: enriched,
      nextCursor: hasMore ? result[result.length - 1].id : null,
    };
  }

  /**
   * Public: Get a single location by ID.
   */
  async getById(id: string): Promise<LocationWithQueue> {
    const location = await this.prisma.location.findUnique({
      where: { id },
    });
    if (!location || location.deletedAt) {
      throw new NotFoundException('Location not found');
    }
    return this.enrichWithQueue(location);
  }

  /**
   * Create a new location (OWNER only). Calls AuditService.
   */
  async create(
    userId: string,
    dto: CreateLocationDto,
    ip?: string,
    userAgent?: string,
  ): Promise<Location> {
    // Create a business if one doesn't exist (simplified; real app would have business management)
    const business = await this.prisma.business.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    if (!business) {
      throw new BadRequestException('No business configured');
    }

    const slug = this.generateSlug(dto.name);
    const location = await this.prisma.location.create({
      data: {
        businessId: business.id,
        name: dto.name,
        slug,
        category: dto.category,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        latitude: dto.latitude,
        longitude: dto.longitude,
        slotDurationMin: dto.slotDurationMin ?? 15,
        maxQueueSize: dto.maxQueueSize ?? 50,
        walkInPercent: dto.walkInPercent ?? 30,
      },
    });

    // Attach the creator as OWNER
    await this.prisma.staffMembership.create({
      data: {
        userId,
        locationId: location.id,
        role: UserRole.OWNER,
      },
    });

    await this.audit.record({
      userId,
      action: AuditAction.LOCATION_CREATED,
      entity: 'Location',
      entityId: location.id,
      ip,
      userAgent,
      metadata: { category: dto.category, name: dto.name },
    });

    return location;
  }

  /**
   * Update a location (OWNER/MANAGER only). Calls AuditService.
   */
  async update(
    id: string,
    userId: string,
    userRole: UserRole,
    dto: UpdateLocationDto,
    ip?: string,
    userAgent?: string,
  ): Promise<Location> {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) {
      throw new NotFoundException('Location not found');
    }

    // Check permissions: OWNER/MANAGER
    if (userRole !== UserRole.OWNER && userRole !== UserRole.MANAGER) {
      throw new ForbiddenException('Only OWNER or MANAGER can update location');
    }

    const updated = await this.prisma.location.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.address && { address: dto.address }),
        ...(dto.slotDurationMin && { slotDurationMin: dto.slotDurationMin }),
        ...(dto.maxQueueSize && { maxQueueSize: dto.maxQueueSize }),
        ...(dto.walkInPercent !== undefined && { walkInPercent: dto.walkInPercent }),
      },
    });

    await this.audit.record({
      userId,
      action: AuditAction.LOCATION_UPDATED,
      entity: 'Location',
      entityId: id,
      ip,
      userAgent,
    });

    return updated;
  }

  /**
   * Attach a staff member to a location (OWNER only).
   */
  async attachStaff(
    locationId: string,
    userId: string,
    userRole: UserRole,
    dto: AttachStaffDto,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      throw new NotFoundException('Location not found');
    }

    if (userRole !== UserRole.OWNER) {
      throw new ForbiddenException('Only OWNER can attach staff');
    }

    // Find staff user by phone
    const staffUser = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (!staffUser) {
      throw new NotFoundException('User not found');
    }

    // Check if already attached
    const existing = await this.prisma.staffMembership.findUnique({
      where: { userId_locationId: { userId: staffUser.id, locationId } },
    });
    if (existing) {
      throw new ConflictException('Staff member already attached to this location');
    }

    await this.prisma.staffMembership.create({
      data: {
        userId: staffUser.id,
        locationId,
        role: dto.role,
      },
    });

    await this.audit.record({
      userId,
      action: AuditAction.PERMISSIONS_CHANGED,
      entity: 'StaffMembership',
      entityId: staffUser.id,
      ip,
      userAgent,
      metadata: { locationId, staffRole: dto.role },
    });
  }

  // --- Private helpers ---

  /**
   * Batch enrichment: one groupBy for live queue counts, one findMany for
   * recent served bookings across the whole page. O(2) DB roundtrips no
   * matter how many locations are in the page.
   */
  private async enrichManyWithQueue(locations: Location[]): Promise<LocationWithQueue[]> {
    if (locations.length === 0) return [];
    const ids = locations.map((l) => l.id);

    const [activeCounts, servedSamples] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['locationId'],
        where: {
          locationId: { in: ids },
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED] },
          slotStart: { gte: new Date() },
        },
        _count: { _all: true },
      }),
      this.prisma.booking.findMany({
        where: {
          locationId: { in: ids },
          status: BookingStatus.SERVED,
          servedStartAt: { not: null },
          servedEndAt: { not: null },
        },
        select: { locationId: true, servedStartAt: true, servedEndAt: true },
        orderBy: { servedEndAt: 'desc' },
        take: 50 * ids.length,
      }),
    ]);

    const countByLocation = new Map<string, number>(
      activeCounts.map((c) => [c.locationId, c._count._all]),
    );

    // Group served samples per location, cap at 50 each
    const servedByLocation = new Map<string, { start: Date; end: Date }[]>();
    for (const s of servedSamples) {
      const arr = servedByLocation.get(s.locationId) ?? [];
      if (arr.length < 50) arr.push({ start: s.servedStartAt!, end: s.servedEndAt! });
      servedByLocation.set(s.locationId, arr);
    }

    return locations.map((loc) => {
      const samples = servedByLocation.get(loc.id) ?? [];
      let avgWaitMinutes = loc.avgServiceSec / 60;
      if (samples.length > 0) {
        const totalMs = samples.reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()), 0);
        avgWaitMinutes = Math.round(totalMs / samples.length / 60000);
      }
      return {
        ...loc,
        liveQueueCount: countByLocation.get(loc.id) ?? 0,
        avgWaitMinutes,
      };
    });
  }

  private async enrichWithQueue(location: Location): Promise<LocationWithQueue> {
    // Count active + confirmed bookings for this location
    const bookings = await this.prisma.booking.findMany({
      where: {
        locationId: location.id,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED] },
        slotStart: { gte: new Date() },
      },
    });

    // Calculate average wait time from served bookings
    const servedBookings = await this.prisma.booking.findMany({
      where: {
        locationId: location.id,
        status: BookingStatus.SERVED,
        servedStartAt: { not: null },
        servedEndAt: { not: null },
      },
      select: { servedStartAt: true, servedEndAt: true },
      take: 50,
    });

    let avgWaitMinutes = location.avgServiceSec / 60;
    if (servedBookings.length > 0) {
      const totalMs = servedBookings.reduce((sum, b) => {
        return sum + (b.servedEndAt!.getTime() - b.servedStartAt!.getTime());
      }, 0);
      avgWaitMinutes = Math.round(totalMs / servedBookings.length / 60000);
    }

    return {
      ...location,
      liveQueueCount: bookings.length,
      avgWaitMinutes,
    };
  }

  private filterByDistance(
    locations: Location[],
    centerLat: number,
    centerLng: number,
    radiusKm: number,
  ): Location[] {
    return locations.filter((loc) => {
      const dist = this.haversineDistance(centerLat, centerLng, loc.latitude, loc.longitude);
      return dist <= radiusKm;
    });
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }
}
