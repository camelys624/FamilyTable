import { DEMO_INVITE_CODE, ensureState, finishOnboarding } from '../../services/store'
import { AppError } from '../../utils/app-error'
import { CompleteOnboardingInput, SessionModule, SessionSnapshot } from './interface'
import { validateOnboardingInput } from './validate'

function toSnapshot(): SessionSnapshot {
  const state = ensureState()
  return {
    onboarded: state.onboarded,
    userName: state.userName,
    avatarUrl: '',
    familyName: state.familyName,
    members: [...state.members],
    source: 'local',
  }
}

export class LocalSessionAdapter implements SessionModule {
  async bootstrap() {
    return toSnapshot()
  }

  async completeOnboarding(input: CompleteOnboardingInput) {
    const normalized = validateOnboardingInput(input)
    if (normalized.mode === 'join' && normalized.inviteCode !== DEMO_INVITE_CODE) {
      throw new AppError('VALIDATION_ERROR', `本地体验版请使用 ${DEMO_INVITE_CODE}`)
    }
    const familyName = normalized.mode === 'join' ? '团团家的饭桌' : normalized.familyName
    finishOnboarding(familyName, normalized.userName)
    return toSnapshot()
  }
}
