import { CloudClient } from '../../repositories/cloud-client'
import { AppError } from '../../utils/app-error'
import { CompleteOnboardingInput, SessionModule, SessionSnapshot } from './interface'
import { validateOnboardingInput } from './validate'

interface LoginResult {
  user: { displayName: string; avatarUrl?: string | null }
  family: { name: string } | null
  member: { displayName?: string } | null
  onboardingRequired: boolean
}

interface CurrentFamilyResult {
  family: { name: string }
  members: Array<{ displayName: string }>
}

export class CloudSessionAdapter implements SessionModule {
  constructor(private readonly client: CloudClient) {}

  async bootstrap(): Promise<SessionSnapshot> {
    const login = await this.client.call<LoginResult>('auth', 'auth.login')
    if (!login.family || login.onboardingRequired) {
      return {
        onboarded: false,
        userName: login.user.displayName,
        avatarUrl: login.user.avatarUrl || '',
        familyName: '',
        members: [],
        source: 'cloud',
      }
    }
    const current = await this.client.call<CurrentFamilyResult>('family', 'family.current')
    return {
      onboarded: true,
      userName: login.user.displayName,
      avatarUrl: login.user.avatarUrl || '',
      familyName: current.family.name,
      members: current.members.map((member) => member.displayName),
      source: 'cloud',
    }
  }

  async completeOnboarding(input: CompleteOnboardingInput) {
    const normalized = validateOnboardingInput(input)
    if (normalized.mode === 'join') {
      throw new AppError('FEATURE_UNAVAILABLE', '云端加入家庭将在成员邀请阶段开放')
    }
    if (input.avatarUrl) {
      await this.client.call('auth', 'auth.updateProfile', {
        displayName: normalized.userName,
        avatarUrl: input.avatarUrl,
      })
    }
    await this.client.call('family', 'family.create', {
      name: normalized.familyName,
      displayName: normalized.userName,
      timezone: 'Asia/Shanghai',
    })
    return this.bootstrap()
  }
}
