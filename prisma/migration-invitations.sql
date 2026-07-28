-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PROJECT_MANAGER',
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by_id" UUID NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invitations_company_id_status_idx" ON "invitations"("company_id", "status");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RLS (defense in depth; the app writes via prisma as table owner).
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitations_owner ON public.invitations;
CREATE POLICY invitations_owner ON public.invitations
  FOR ALL USING (company_id = public.current_company_id() AND public.is_owner())
  WITH CHECK (company_id = public.current_company_id() AND public.is_owner());

-- Follow-up: store the invited auth user id for cleanup on cancel/remove.
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "auth_user_id" UUID;
