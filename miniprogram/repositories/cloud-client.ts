import { AppError, AppErrorCode, toAppError } from '../utils/app-error'
import { createRequestId } from '../utils/request-id'

interface CloudFunctionResponse<T> {
  ok: boolean
  data?: T
  error?: {
    code?: AppErrorCode
    message?: string
    details?: Record<string, unknown>
  }
  requestId?: string
}

export interface CloudTransport {
  callFunction(options: { name: string; data: Record<string, unknown> }): Promise<{ result?: unknown }>
}

export class CloudClient {
  constructor(private readonly transport: CloudTransport) {}

  async call<T>(
    functionName: string,
    action: string,
    payload: Record<string, unknown> = {},
    requestId = createRequestId(),
  ): Promise<T> {
    try {
      const response = await this.transport.callFunction({
        name: functionName,
        data: { action, payload, requestId },
      })
      const result = response.result as CloudFunctionResponse<T> | undefined
      if (!result || typeof result.ok !== 'boolean') {
        throw new AppError('INVALID_RESPONSE', '服务返回了无法识别的数据', requestId)
      }
      if (!result.ok) {
        throw new AppError(
          result.error?.code || 'INTERNAL_ERROR',
          result.error?.message || '服务暂时不可用，请稍后重试',
          result.requestId || requestId,
          result.error?.details || {},
        )
      }
      if (result.data === undefined) {
        throw new AppError('INVALID_RESPONSE', '服务没有返回所需数据', result.requestId || requestId)
      }
      return result.data
    } catch (error) {
      throw toAppError(error)
    }
  }
}

export function createWxCloudClient() {
  return new CloudClient({
    callFunction: (options) => wx.cloud.callFunction(options),
  })
}
