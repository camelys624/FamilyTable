import { AppError } from '../../utils/app-error'
import { CompleteOnboardingInput } from './interface'

export interface NormalizedOnboardingInput {
  mode: 'create' | 'join'
  userName: string
  familyName: string
  inviteCode: string
}

export function validateOnboardingInput(input: CompleteOnboardingInput): NormalizedOnboardingInput {
  if (input.termsAccepted !== true) throw new AppError('VALIDATION_ERROR', '请先阅读并同意用户协议和隐私政策')
  const userName = input.userName.trim()
  const familyName = (input.familyName || '').trim()
  const inviteCode = (input.inviteCode || '').trim().toUpperCase()

  if (!userName) throw new AppError('VALIDATION_ERROR', '先写下你的称呼')
  if (userName.length > 12) throw new AppError('VALIDATION_ERROR', '称呼最多填写 12 个字')
  if (input.mode === 'create' && !familyName) throw new AppError('VALIDATION_ERROR', '给小饭桌取个名字')
  if (familyName.length > 20) throw new AppError('VALIDATION_ERROR', '家庭名称最多填写 20 个字')
  if (input.mode !== 'create' && input.mode !== 'join') throw new AppError('VALIDATION_ERROR', '请选择创建或加入家庭')
  if (input.mode === 'join' && !/^[A-HJ-NP-Z2-9]{8}$/.test(inviteCode)) throw new AppError('VALIDATION_ERROR', '请填写 8 位家庭邀请码')

  return { mode: input.mode, userName, familyName, inviteCode }
}
