export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FAMILY_REQUIRED'
  | 'NOT_FAMILY_MEMBER'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'ALREADY_COOKED'
  | 'VOTE_ALREADY_CAST'
  | 'POLL_CLOSED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'RATE_LIMITED'
  | 'FEATURE_UNAVAILABLE'
  | 'CLOUD_ENV_NOT_FOUND'
  | 'CLOUD_FUNCTION_NOT_FOUND'
  | 'DATABASE_NOT_INITIALIZED'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'INTERNAL_ERROR'

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly requestId = '',
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function toAppError(error: unknown) {
  if (error instanceof AppError) return error
  const cause = error instanceof Error ? error.message : String(error)
  const normalized = cause.toLowerCase()

  if (normalized.includes('environment not found') || normalized.includes('env not exists') || normalized.includes('invalid_env')) {
    return new AppError('CLOUD_ENV_NOT_FOUND', '云开发环境未就绪，请联系管理员', '', { cause })
  }
  if (normalized.includes('functionname parameter could not be found') || normalized.includes('function_not_found')) {
    return new AppError('CLOUD_FUNCTION_NOT_FOUND', '云函数尚未部署，请联系管理员', '', { cause })
  }
  if (
    /(collection|database|table|namespace)/.test(normalized) &&
    /(not found|not exist|does not exist|不存在|未找到|未创建)/.test(normalized)
  ) {
    return new AppError('DATABASE_NOT_INITIALIZED', '数据库尚未初始化，请联系管理员', '', { cause })
  }
  return new AppError('NETWORK_ERROR', '网络没有连上，请检查后重试', '', { cause })
}
