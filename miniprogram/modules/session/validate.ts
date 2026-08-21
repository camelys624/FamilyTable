import { AppError } from '../../utils/app-error'
import { CompleteOnboardingInput } from './interface'

export interface NormalizedOnboardingInput {
  mode: 'create' | 'join'
  userName: string
  familyName: string
  inviteCode: string
}

export function validateOnboardingInput(input: CompleteOnboardingInput): NormalizedOnboardingInput {
  const userName = input.userName.trim()
  const familyName = (input.familyName || '').trim()
  const inviteCode = (input.inviteCode || '').trim().toUpperCase()

  if (!userName) throw new AppError('VALIDATION_ERROR', '先写下你的称呼')
  if (userName.length > 12) throw new AppError('VALIDATION_ERROR', '称呼最多填写 12 个字')
  if (input.mode === 'create' && !familyName) throw new AppError('VALIDATION_ERROR', '给小饭桌取个名字')
  if (familyName.length > 20) throw new AppError('VALIDATION_ERROR', '家庭名称最多填写 20 个字')
  if (input.mode === 'join' && inviteCode.length < 4) throw new AppError('VALIDATION_ERROR', '邀请码至少填写 4 位')

  return { mode: input.mode, userName, familyName, inviteCode }
}
