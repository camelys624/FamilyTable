export interface FamilyMember {
  id: string
  displayName: string
  role: 'owner' | 'member'
}

export interface CurrentFamily {
  family: FamilyInfo
  currentMember: FamilyMember
  members: FamilyMember[]
  invitation: { active: boolean; expiresAt: string }
}

export interface FamilyInfo { id: string; name: string; infoVersion: number }

export interface FamilyInvitation {
  familyId: string
  inviteCode: string
  expiresAt: string
}

export interface FamilyModule {
  getCurrentFamily(): Promise<CurrentFamily>
  createInvitation(requestId: string): Promise<FamilyInvitation>
  updateFamily(name: string, expectedVersion: number, requestId: string): Promise<{ family: FamilyInfo }>
}
