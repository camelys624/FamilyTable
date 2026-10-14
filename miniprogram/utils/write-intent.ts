import { AppError, toAppError } from './app-error'
import { createRequestId } from './request-id'

export class WriteIntent {
  pending: { action: string; input: Record<string, unknown>; requestId: string } | null = null

  async run<T>(action: string, input: Record<string, unknown>, write: (requestId: string) => Promise<T>): Promise<T> {
    const key = JSON.stringify({ action, input })
    if (this.pending && JSON.stringify({ action: this.pending.action, input: this.pending.input }) !== key) {
      throw new AppError('REQUEST_IN_PROGRESS', '上次操作结果还未确认，请先重试上次操作')
    }
    this.pending = this.pending || { action, input: JSON.parse(JSON.stringify(input)), requestId: createRequestId() }
    try {
      const result = await write(this.pending.requestId)
      this.pending = null
      return result
    } catch (error) {
      const failure = toAppError(error)
      if (!['NETWORK_ERROR', 'REQUEST_IN_PROGRESS'].includes(failure.code)) this.pending = null
      throw failure
    }
  }
}
