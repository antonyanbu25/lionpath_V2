/** Org — groups multiple teams under one director (role: manager). */

export interface OrgSegment {
  id: string;
  name: string;
  leaderId: string;
  teamIds: string[];
}

export interface Org {
  id: string;
  name: string;
  directorId: string;
  seniorLeaderIds: string[];
  teamIds: string[];
  segments?: OrgSegment[];
  createdAt: number;
  updatedAt: number;
}
