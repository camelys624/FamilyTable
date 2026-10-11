import { runtimeConfig } from '../../config/runtime'
import { CloudClient } from '../../repositories/cloud-client'
import { AppError } from '../../utils/app-error'
import { CookInput, DishSuggestion, FridgeBatch, FridgeModule, FridgeRecord } from './interface'

const BATCH_STATUS_LABELS: Record<string, string> = {
  available: '有剩 · 可用', expired: '已过期 · 有剩', spoiled: '变质 · 不可用',
  usedUp: '已用完', discarded: '已丢弃',
}
const RECORD_FIELD_LABELS: Record<string, string> = { name: '名称', expiresOn: '保质期' }
const DISCARD_REASON_LABELS: Record<string, string> = { expired: '过期', spoiled: '变质', other: '其他原因' }

function invalidResponse(): never {
  throw new AppError('INVALID_RESPONSE', '冰箱服务返回的数据格式不正确，请刷新后重试')
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidResponse()
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : invalidResponse()
}

function flag(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalidResponse()
}

function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(parse) : invalidResponse()
}

function parseBatch(value: unknown): FridgeBatch {
  const batch = object(value)
  const version = batch.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return invalidResponse()
  const expiresOn = text(batch.expiresOn)
  const status = text(batch.status)
  return {
    id: text(batch.id), name: text(batch.name), version,
    expiresOn, remaining: flag(batch.remaining),
    usable: flag(batch.usable), expired: flag(batch.expired),
    statusLabel: BATCH_STATUS_LABELS[status] || '状态待核对', expiryLabel: expiresOn || '未填写',
  }
}

function parseRecord(value: unknown): FridgeRecord {
  const record = object(value)
  const type = text(record.type)
  const timestamp = record.createdAt
  const time = timestamp instanceof Date
    ? timestamp
    : typeof timestamp === 'string' ? new Date(timestamp) : invalidResponse()
  if (!Number.isFinite(time.getTime())) return invalidResponse()
  let typeLabel = '食材变动'
  let detail = ''
  if (type === 'added') {
    typeLabel = '入库'
    detail = '放进冰箱，记为有剩'
  } else if (type === 'edited') {
    typeLabel = '修改'
    detail = `调整：${list(record.changes, text).map((field) => RECORD_FIELD_LABELS[field] || field).join('、')}`
  } else if (type === 'cooked') {
    typeLabel = '做菜消耗'
    detail = `${text(record.recipeName)} · ${flag(record.usedUp) ? '已用完' : '仍有剩'}`
  } else if (type === 'discarded') {
    const reason = text(record.reason)
    typeLabel = reason === 'expired' ? '过期报损' : '报损'
    detail = `${DISCARD_REASON_LABELS[reason] || reason} · ${flag(record.usedUp) ? '全部丢弃' : '部分报损，仍有剩'}`
  }
  return {
    id: text(record.id), name: text(record.name), typeLabel, detail,
    timeLabel: time.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
  }
}

function parseSuggestion(value: unknown): DishSuggestion {
  const suggestion = object(value)
  return {
    name: text(suggestion.name), canCook: flag(suggestion.canCook), reason: text(suggestion.reason),
    availableLabel: list(suggestion.available, text).join('、'),
    missingLabel: list(suggestion.missing, text).join('、'),
    stepsLabel: list(suggestion.steps, text).join(' → '),
  }
}

export class CloudFridgeAdapter implements FridgeModule {
  constructor(private readonly client: CloudClient) {}

  private async call(action: string, payload: Record<string, unknown> = {}, requestId?: string) {
    if (runtimeConfig.repositoryMode !== 'cloud') {
      throw new AppError('FEATURE_UNAVAILABLE', '冰箱需要云端家庭共享数据，本地演示模式不支持，请切换云端配置')
    }
    return object(await this.client.call<unknown>('fridge', action, payload, requestId))
  }

  async listBatches() {
    const result = await this.call('fridge.listBatches')
    return list(result.batches, parseBatch)
  }

  async listRecords(cursor = '') {
    const result = await this.call('fridge.listRecords', { cursor, pageSize: 20 })
    return { records: list(result.records, parseRecord), nextCursor: text(result.nextCursor) }
  }

  async createBatch(input: { name: string; expiresOn: string }, requestId: string) {
    await this.call('fridge.createBatch', { ...input }, requestId)
  }

  async updateBatch(input: { batchId: string; expectedVersion: number; name: string; expiresOn: string }, requestId: string) {
    await this.call('fridge.updateBatch', { ...input }, requestId)
  }

  async discardBatch(input: { batchId: string; expectedVersion: number; reason: 'expired' | 'spoiled' | 'other'; usedUp: boolean }, requestId: string) {
    await this.call('fridge.discardBatch', { ...input }, requestId)
  }

  async cook(input: CookInput, requestId: string) {
    const result = await this.call('fridge.cook', { ...input }, requestId)
    return list(result.batches, parseBatch)
  }

  async suggest() {
    const result = await this.call('fridge.suggest')
    return list(result.suggestions, parseSuggestion)
  }
}
