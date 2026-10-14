import { CloudClient } from '../../repositories/cloud-client'
import { createRequestId } from '../../utils/request-id'
import { legalConfig } from '../../config/legal'
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
  currentMember?: { displayName: string }
  members: Array<{ displayName: string }>
}

export class CloudSessionAdapter implements SessionModule {
  private onboardingRequest: { key: string; requestId: string } | null = null
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
      userName: current.currentMember?.displayName || login.user.displayName,
      avatarUrl: login.user.avatarUrl || '',
      familyName: current.family.name,
      members: current.members.map((member) => member.displayName),
      source: 'cloud',
    }
  }

  async completeOnboarding(input: CompleteOnboardingInput) {
    const normalized = validateOnboardingInput(input)
    const key = JSON.stringify(normalized)
    if (this.onboardingRequest?.key !== key) this.onboardingRequest = { key, requestId: createRequestId() }
    const requestId = this.onboardingRequest.requestId
    await this.client.call('auth', 'auth.acceptTerms', { version: legalConfig.version }, `${requestId}_terms`)
    if (input.avatarUrl) {
      await this.client.call('auth', 'auth.updateProfile', {
        displayName: normalized.userName,
        avatarUrl: input.avatarUrl,
      })
    }
    if (normalized.mode === 'join') {
      await this.client.call('family', 'family.join', {
        inviteCode: normalized.inviteCode, displayName: normalized.userName,
      }, requestId)
    } else {
      await this.client.call('family', 'family.create', {
        name: normalized.familyName, displayName: normalized.userName, timezone: 'Asia/Shanghai',
      }, requestId)
    }
    const snapshot = await this.bootstrap()
    this.onboardingRequest = null
    return snapshot
  }
}
