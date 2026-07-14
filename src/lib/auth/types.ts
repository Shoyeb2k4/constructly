export type Role = "OWNER" | "PROJECT_MANAGER";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  company: {
    id: string;
    name: string;
  };
}
