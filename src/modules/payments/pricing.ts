import { LocationCategory } from '@prisma/client';

/**
 * Priority slot pricing in Nigerian Naira (kobo).
 * Elderly/accessibility users exempt (free).
 */
export const PRIORITY_SLOT_PRICING: Record<LocationCategory, number> = {
  BANK: 100_000, // ₦1,000
  HOSPITAL: 50_000, // ₦500
  GOVERNMENT: 50_000, // ₦500
  SALON: 20_000, // ₦200
  TELECOM: 30_000, // ₦300
  OTHER: 40_000, // ₦400
};

export function getPrioritySlotPrice(category: LocationCategory): number {
  return PRIORITY_SLOT_PRICING[category] ?? PRIORITY_SLOT_PRICING.OTHER;
}
