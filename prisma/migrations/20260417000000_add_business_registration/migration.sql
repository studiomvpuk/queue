-- AlterTable: Make phone nullable (for email-only business signups)
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;

-- AlterTable: Add passwordHash to User
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- CreateEnum
CREATE TYPE "BusinessSize" AS ENUM ('INDIVIDUAL', 'SME', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LIMITED_LIABILITY', 'NGO', 'GOVERNMENT', 'HOSPITAL', 'EDUCATIONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- AlterTable: Expand Business model
ALTER TABLE "Business" ADD COLUMN "size" "BusinessSize" NOT NULL DEFAULT 'SME';
ALTER TABLE "Business" ADD COLUMN "type" "BusinessType" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "Business" ADD COLUMN "category" "LocationCategory" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "Business" ADD COLUMN "description" TEXT;
ALTER TABLE "Business" ADD COLUMN "cacNumber" TEXT;
ALTER TABLE "Business" ADD COLUMN "tinNumber" TEXT;
ALTER TABLE "Business" ADD COLUMN "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Business" ADD COLUMN "verificationNote" TEXT;
ALTER TABLE "Business" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "contactFirstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN "contactLastName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN "contactEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN "contactPhone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Business" ADD COLUMN "contactRole" TEXT;
ALTER TABLE "Business" ADD COLUMN "businessEmail" TEXT;
ALTER TABLE "Business" ADD COLUMN "businessPhone" TEXT;
ALTER TABLE "Business" ADD COLUMN "website" TEXT;
ALTER TABLE "Business" ADD COLUMN "address" TEXT;
ALTER TABLE "Business" ADD COLUMN "city" TEXT;
ALTER TABLE "Business" ADD COLUMN "state" TEXT;
ALTER TABLE "Business" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'Nigeria';
ALTER TABLE "Business" ADD COLUMN "ownerId" TEXT;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Business_ownerId_idx" ON "Business"("ownerId");
CREATE INDEX "Business_verificationStatus_idx" ON "Business"("verificationStatus");
CREATE INDEX "Business_category_idx" ON "Business"("category");
