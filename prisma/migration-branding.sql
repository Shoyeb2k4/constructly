-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "address_line" TEXT,
ADD COLUMN     "brand_colors" JSONB,
ADD COLUMN     "cin" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'India',
ADD COLUMN     "dark_logo_path" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "favicon_path" TEXT,
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "light_logo_path" TEXT,
ADD COLUMN     "logo_path" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "square_logo_path" TEXT,
ADD COLUMN     "stamp_path" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "language" TEXT DEFAULT 'en',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "photo_path" TEXT,
ADD COLUMN     "signature_path" TEXT,
ADD COLUMN     "theme" TEXT DEFAULT 'system',
ADD COLUMN     "timezone" TEXT DEFAULT 'Asia/Kolkata';

