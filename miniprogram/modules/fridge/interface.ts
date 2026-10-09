import { MealType } from '../../models/types'

export interface FridgeBatch {
  id: string
  name: string
  version: number
  expiresOn: string
  remaining: boolean
  usable: boolean
  expired: boolean
  statusLabel: string
  expiryLabel: string
}

export interface FridgeRecord {
  id: string
  name: string
  typeLabel: string
  detail: string
  timeLabel: string
}

export interface DishSuggestion {
  name: string
  canCook: boolean
  reason: string
  availableLabel: string
  missingLabel: string
  stepsLabel: string
}

export interface CookInput {
  menuId: string
  itemId: string
  date: string
  mealType: MealType
  batches: { batchId: string; expectedVersion: number; usedUp: boolean }[]
}

export interface FridgeModule {
  listBatches(): Promise<FridgeBatch[]>
  listRecords(cursor?: string): Promise<{ records: FridgeRecord[]; nextCursor: string }>
  createBatch(input: { name: string; expiresOn: string }, requestId: string): Promise<void>
  updateBatch(input: { batchId: string; expectedVersion: number; name: string; expiresOn: string }, requestId: string): Promise<void>
  discardBatch(input: { batchId: string; expectedVersion: number; reason: 'expired' | 'spoiled' | 'other'; usedUp: boolean }, requestId: string): Promise<void>
  cook(input: CookInput, requestId: string): Promise<FridgeBatch[]>
  suggest(): Promise<DishSuggestion[]>
}
