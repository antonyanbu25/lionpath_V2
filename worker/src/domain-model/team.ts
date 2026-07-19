/** Team of SEs under one manager. */

export interface Team {
  id: string;
  name: string;
  orgId: string | null;
  managerId: string;
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
}
