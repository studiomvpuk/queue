import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuditAction, BookingStatus } from '@prisma/client';
import { CreateReviewDto } from './dto/create-review.dto';
import { RespondReviewDto } from './dto/respond-review.dto';
import { containsProfanity } from './profanity';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createReview(
    userId: string,
    dto: CreateReviewDto,
    ip: string,
    userAgent: string,
  ) {
    // Fetch booking with user and location
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: { user: true, location: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Only the booking owner can review
    if (booking.userId !== userId) {
      throw new ForbiddenException(
        'You can only review your own bookings',
      );
    }

    // Must be SERVED status
    if (booking.status !== BookingStatus.SERVED) {
      throw new BadRequestException(
        'Can only review bookings with SERVED status',
      );
    }

    // Within 7 days of service
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (booking.servedEndAt && booking.servedEndAt < sevenDaysAgo) {
      throw new BadRequestException(
        'Reviews must be submitted within 7 days of service',
      );
    }

    // One review per booking
    const existing = await this.prisma.review.findUnique({
      where: { bookingId: dto.bookingId },
    });

    if (existing) {
      throw new BadRequestException('Review already exists for this booking');
    }

    // Check profanity
    const isHidden = dto.comment ? containsProfanity(dto.comment) : false;

    // Create review and update location stats in transaction
    const review = await this.prisma.$transaction(async (tx) => {
      const newReview = await tx.review.create({
        data: {
          bookingId: dto.bookingId,
          userId,
          locationId: booking.locationId,
          rating: dto.rating,
          comment: dto.comment,
          isHidden,
        },
      });

      // Update location ratingAvg and ratingCount
      const location = booking.location;
      const newCount = (location.ratingCount || 0) + 1;
      const newAvg =
        ((location.ratingAvg || 0) * (location.ratingCount || 0) + dto.rating) /
        newCount;

      await tx.location.update({
        where: { id: booking.locationId },
        data: {
          ratingCount: newCount,
          ratingAvg: newAvg,
        },
      });

      return newReview;
    });

    await this.audit.record({
      userId,
      action: AuditAction.BOOKING_REVIEWED,
      entity: 'Review',
      entityId: review.id,
      ip,
      userAgent,
      metadata: { bookingId: dto.bookingId, rating: dto.rating },
    });

    return review;
  }

  async getLocationReviews(locationId: string, cursor?: string, limit = 10) {
    const reviews = await this.prisma.review.findMany({
      where: {
        locationId,
        isHidden: false, // Public default; staff override in controller
      },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, phone: true } } },
    });

    return reviews;
  }

  async getLocationReviewsForStaff(locationId: string, cursor?: string, limit = 10) {
    // Staff can see all reviews, including hidden
    const reviews = await this.prisma.review.findMany({
      where: { locationId },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, phone: true } } },
    });

    return reviews;
  }

  async respondToReview(
    reviewId: string,
    locationId: string,
    userId: string,
    dto: RespondReviewDto,
    ip: string,
    userAgent: string,
  ) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { location: true },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    // Verify location match
    if (review.locationId !== locationId) {
      throw new BadRequestException('Review does not belong to this location');
    }

    // Verify user is OWNER/MANAGER of location (via StaffMembership)
    const membership = await this.prisma.staffMembership.findUnique({
      where: {
        userId_locationId: {
          userId,
          locationId,
        },
      },
    });

    if (!membership || !['OWNER', 'MANAGER'].includes(membership.role)) {
      throw new ForbiddenException(
        'Only location managers can respond to reviews',
      );
    }

    // One reply per review
    if (review.response) {
      throw new BadRequestException(
        'Review already has a response',
      );
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { response: dto.response },
    });

    await this.audit.record({
      userId,
      action: AuditAction.REVIEW_RESPONDED,
      entity: 'Review',
      entityId: reviewId,
      ip,
      userAgent,
    });

    return updated;
  }
}
