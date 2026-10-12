import { DEMO_INVITE_CODE, getState } from '../../services/store'
import { CurrentFamily, FamilyModule } from './interface'

export class LocalFamilyAdapter implements FamilyModule {
  async getCurrentFamily(): Promise<CurrentFamily> {
    const state = getState()
    const members = state.members.map((name, index) => ({
      id: `local-${index}`, displayName: name, role: index === 0 ? 'owner' as const : 'member' as const,
    }))
    return {
      family: { id: 'local-family', name: state.familyName },
      currentMember: members.find((member) => member.displayName === state.userName) || members[0],
      members, invitation: { active: false, expiresAt: '' },
    }
  }

  async createInvitation() {
    return { familyId: 'local-family', inviteCode: DEMO_INVITE_CODE, expiresAt: new Date(Date.now() + 72 * 3600000).toISOString() }
  }
}
