import { DEMO_INVITE_CODE, getState, saveState } from '../../services/store'
import { AppError } from '../../utils/app-error'
import { CurrentFamily, FamilyModule } from './interface'

export class LocalFamilyAdapter implements FamilyModule {
  private infoVersion = 0
  async getCurrentFamily(): Promise<CurrentFamily> {
    const state = getState()
    const members = state.members.map((name, index) => ({
      id: `local-${index}`, displayName: name, role: index === 0 ? 'owner' as const : 'member' as const,
    }))
    return {
      family: { id: 'local-family', name: state.familyName, infoVersion: this.infoVersion },
      currentMember: members.find((member) => member.displayName === state.userName) || members[0],
      members, invitation: { active: false, expiresAt: '' },
    }
  }

  async createInvitation() {
    return { familyId: 'local-family', inviteCode: DEMO_INVITE_CODE, expiresAt: new Date(Date.now() + 72 * 3600000).toISOString() }
  }

  async updateFamily(name: string, expectedVersion: number) {
    const current = await this.getCurrentFamily()
    if (current.currentMember.role !== 'owner') throw new AppError('FORBIDDEN', '只有饭桌家长可以修改饭桌信息')
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 40) throw new AppError('VALIDATION_ERROR', '饭桌名称需填写 1～40 个字')
    if (expectedVersion !== this.infoVersion) throw new AppError('VERSION_CONFLICT', '饭桌信息已更新，请重新加载后修改')
    const state = getState()
    state.familyName = trimmed
    saveState(state)
    this.infoVersion++
    return { family: { id: 'local-family', name: trimmed, infoVersion: this.infoVersion } }
  }
}
