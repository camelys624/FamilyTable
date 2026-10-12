export interface FamilyMember {
  id: string
  displayName: string
  role: 'owner' | 'member'
}

export interface CurrentFamily {
  family: { id: string; name: string }
  currentMember: FamilyMember
  members: FamilyMember[]
  invitation: { active: boolean; expiresAt: string }
}

export interface FamilyInvitation {
  familyId: string
  inviteCode: string
  expiresAt: string
}

export interface FamilyModule {
  getCurrentFamily(): Promise<CurrentFamily>
  createInvitation(requestId: string): Promise<FamilyInvitation>
}
