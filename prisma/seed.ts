import { PrismaClient, UserRole, LocationCategory, BookingStatus, BookingSource } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clean existing data
  await prisma.booking.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.staffMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.location.deleteMany();
  await prisma.business.deleteMany();

  // 1. Create business (Zenith Bank)
  const business = await prisma.business.create({
    data: {
      name: 'Zenith Bank Nigeria',
      slug: 'zenith-bank',
      logoUrl: 'https://via.placeholder.com/200',
    },
  });
  console.log('✓ Created business:', business.name);

  // 2. Create locations
  const locations = await Promise.all([
    prisma.location.create({
      data: {
        businessId: business.id,
        name: 'Zenith Ikeja',
        slug: 'zenith-ikeja',
        category: LocationCategory.BANK,
        address: '123 Awolowo Road, Ikeja',
        city: 'Lagos',
        state: 'Lagos',
        latitude: 6.5793,
        longitude: 3.3469,
        slotDurationMin: 15,
        maxQueueSize: 50,
        walkInPercent: 30,
        avgServiceSec: 240,
      },
    }),
    prisma.location.create({
      data: {
        businessId: business.id,
        name: 'General Hospital Lagos',
        slug: 'general-hospital-lagos',
        category: LocationCategory.HOSPITAL,
        address: 'Museum Hill, Lagos Island',
        city: 'Lagos',
        state: 'Lagos',
        latitude: 6.4667,
        longitude: 3.425,
        slotDurationMin: 30,
        maxQueueSize: 100,
        walkInPercent: 20,
        avgServiceSec: 600,
      },
    }),
    prisma.location.create({
      data: {
        businessId: business.id,
        name: 'Glam Hair & Beauty',
        slug: 'glam-salon',
        category: LocationCategory.SALON,
        address: '456 Lekki Road, Lekki',
        city: 'Lagos',
        state: 'Lagos',
        latitude: 6.4667,
        longitude: 3.5833,
        slotDurationMin: 60,
        maxQueueSize: 30,
        walkInPercent: 40,
        avgServiceSec: 1200,
      },
    }),
  ]);
  console.log(`✓ Created ${locations.length} locations`);

  // 3. Create test users
  const users = await Promise.all([
    prisma.user.create({
      data: {
        phone: '+2348012345678',
        firstName: 'John',
        email: 'john@example.com',
        role: UserRole.CUSTOMER,
        isVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+2348012345679',
        firstName: 'Jane',
        email: 'jane@example.com',
        role: UserRole.CUSTOMER,
        isVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+2348012345680',
        firstName: 'Ahmed',
        email: 'ahmed@example.com',
        role: UserRole.STAFF,
        isVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+2348012345681',
        firstName: 'Zainab',
        email: 'zainab@example.com',
        role: UserRole.STAFF,
        isVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+2348012345682',
        firstName: 'Boss',
        email: 'boss@example.com',
        role: UserRole.OWNER,
        isVerified: true,
      },
    }),
  ]);
  console.log(`✓ Created ${users.length} users`);

  // 4. Attach staff to salon location
  await prisma.staffMembership.createMany({
    data: [
      { userId: users[2].id, locationId: locations[2].id, role: UserRole.STAFF },
      { userId: users[3].id, locationId: locations[2].id, role: UserRole.STAFF },
      { userId: users[4].id, locationId: locations[2].id, role: UserRole.OWNER },
    ],
  });
  console.log('✓ Attached staff members to salon');

  // 5. Create 20 synthetic bookings across various states
  const now = new Date();
  const bookingStates: Array<[BookingStatus, Date | null]> = [
    [BookingStatus.CONFIRMED, null],
    [BookingStatus.ARRIVED, now],
    [BookingStatus.SERVING, now],
    [BookingStatus.SERVED, new Date(now.getTime() - 2 * 60 * 60 * 1000)],
    [BookingStatus.CANCELLED, new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)],
    [BookingStatus.NO_SHOW, new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)],
  ];

  let bookingIndex = 0;
  for (let i = 0; i < 20; i++) {
    const [status, timestamp] = bookingStates[bookingIndex % bookingStates.length];
    const slotStart = new Date(now.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);

    await prisma.booking.create({
      data: {
        code: `${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random() * 100)}-${Math.floor(Math.random() * 100)}`,
        userId: users[i % 2].id, // Alternate between two customers
        locationId: locations[i % 3].id, // Rotate through locations
        slotStart,
        slotEnd,
        status,
        source: BookingSource.APP,
        arrivedAt: status === BookingStatus.ARRIVED || status === BookingStatus.SERVING ? timestamp : null,
        servedStartAt: status === BookingStatus.SERVING || status === BookingStatus.SERVED ? timestamp : null,
        servedEndAt: status === BookingStatus.SERVED ? new Date((timestamp || now).getTime() + 20 * 60 * 1000) : null,
        cancelledAt: status === BookingStatus.CANCELLED ? timestamp : null,
        noShowAt: status === BookingStatus.NO_SHOW ? timestamp : null,
      },
    });
    bookingIndex++;
  }
  console.log('✓ Created 20 synthetic bookings');

  console.log('✨ Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
