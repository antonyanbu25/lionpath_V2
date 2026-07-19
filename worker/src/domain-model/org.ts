/** Org — groups multiple teams under one director (role: manager). */

export interface Org {
  id: string;
  name: string;
  directorId: string;
  seniorLeaderIds: string[];
  teamIds: string[];
  createdAt: number;
  updatedAt: number;
}
