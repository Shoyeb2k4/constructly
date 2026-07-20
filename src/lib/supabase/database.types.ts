// Generated from the live production database (project rbteppevgibwddihqcpf) via
// the Supabase MCP. Reference for the Supabase JS client (Storage/Auth); the
// app's data layer is typed by Prisma. Regenerate after schema changes:
//   supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Enums: {
      ContractorStatus: "ACTIVE" | "INACTIVE"
      DocumentCategory: "DRAWING" | "PDF" | "PHOTO" | "CONTRACT" | "OTHER"
      PaymentMode: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CARD" | "OTHER"
      ProjectStage:
        | "CREATED" | "PLANNING" | "ESTIMATION" | "PROCUREMENT"
        | "CONSTRUCTION" | "QUALITY_INSPECTION" | "COMPLETION" | "HANDOVER" | "CLOSED"
      ProjectType:
        | "RESIDENTIAL" | "COMMERCIAL" | "INDUSTRIAL" | "INFRASTRUCTURE"
        | "RENOVATION" | "INTERIOR_FITOUT"
      PurchaseOrderStatus: "DRAFT" | "SUBMITTED" | "APPROVED"
      Role: "OWNER" | "PROJECT_MANAGER"
      UserStatus: "ACTIVE" | "INVITED" | "DISABLED"
      VendorStatus: "ACTIVE" | "INACTIVE"
    }
  }
}
