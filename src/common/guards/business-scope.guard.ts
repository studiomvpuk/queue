import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * BusinessScopeGuard verifies that the caller has a StaffMembership
 * covering the requested locationId or businessId.
 *
 * Expects the request params to include:
 * - locationId (string) OR
 * - businessId (string, will check all locations in that business)
 *
 * OWNER/MANAGER/STAFF can access. CUSTOMER/ADMIN bypass.
 */
@Injectable()
export class BusinessScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = req.user;

    if (!user) {
      throw new ForbiddenException('No user in request');
    }

    // Admins bypass scope checks
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    // Customers don't have staff memberships
    if (user.role === UserRole.CUSTOMER) {
      throw new ForbiddenException('Customers cannot access this resource');
    }

    const { locationId, businessId } = req.params;

    if (locationId) {
      // Check if user has staff membership at this location
      const membership = await this.prisma.staffMembership.findUnique({
        where: {
          userId_locationId: {
            userId: user.sub,
            locationId,
          },
        },
      });

      if (!membership) {
        throw new ForbiddenException(
          'You do not have access to this location',
        );
      }

      return true;
    }

    if (businessId) {
      // Check if user has staff membership at any location in this business
      const membership = await this.prisma.staffMembership.findFirst({
        where: {
          userId: user.sub,
          location: {
            businessId,
          },
        },
      });

      if (!membership) {
        throw new ForbiddenException(
          'You do not have access to this business',
        );
      }

      return true;
    }

    throw new ForbiddenException(
      'Request missing locationId or businessId parameter',
    );
  }
}
