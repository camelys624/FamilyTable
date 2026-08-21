export type OnboardingMode = 'create' | 'join'

export interface SessionSnapshot {
  onboarded: boolean
  userName: string
  avatarUrl: string
  familyName: string
  members: string[]
  source: 'local' | 'cloud'
}

export interface CompleteOnboardingInput {
  mode: OnboardingMode
  userName: string
  familyName?: string
  inviteCode?: string
  avatarUrl?: string
}

export interface SessionModule {
  bootstrap(): Promise<SessionSnapshot>
  completeOnboarding(input: CompleteOnboardingInput): Promise<SessionSnapshot>
}
