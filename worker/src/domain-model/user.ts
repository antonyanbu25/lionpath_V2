/** Authenticated Freshworks user (SE, Manager, or Admin). */

export type UserRole = "se" | "manager" | "pm" | "admin";

export type UserStatus = "active" | "inactive";

export interface User {
  id: string;
  email: string;
  authUid: string | null;
  displayName: string;
  role: UserRole;
  teamId: string | null;
  orgId: string | null;
  managerId: string | null;
  jobTitle: string | null;
  avatarDataUrl?: string | null;
  status: UserStatus;
  createdAt: number;
  updatedAt: number;
}

export function isManagerRole(role: UserRole): boolean {
  return role === "manager" || role === "admin";
}

export function isSeRole(role: UserRole): boolean {
  return role === "se";
}
