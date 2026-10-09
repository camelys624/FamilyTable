import { fridgeModule } from '../../modules/fridge/index'
import { DishSuggestion, FridgeBatch, FridgeRecord } from '../../modules/fridge/interface'
import { ensureSession } from '../../modules/session/index'
import { toAppError } from '../../utils/app-error'
import { createRequestId } from '../../utils/request-id'

interface BatchEvent {
  currentTarget: { dataset: { id: string } }
}

interface ValueEvent {
  detail: { value: string }
}

interface CheckboxEvent {
  detail: { value: string[] }
}

const DISCARD_REASONS = ['expired', 'spoiled', 'other'] as const

async function hasFamily() {
  const session = await ensureSession()
  if (session.onboarded) return true
  wx.reLaunch({ url: '/pages/onboarding/index' })
  return false
}

Page({
  data: {
    batches: [] as FridgeBatch[],
    availableCount: 0,
    loading: false,
    loadError: '',
    editorVisible: false,
    editingId: '',
    editingVersion: 0,
    formName: '',
    formExpiry: '',
    discardId: '',
    discardVersion: 0,
    discardName: '',
    discardReasons: ['过期', '变质', '其他'],
    discardReasonIndex: 0,
    discardUsedUp: true,
    saving: false,
    saveError: '',
    suggestions: [] as DishSuggestion[],
    aiLoading: false,
    aiLoaded: false,
    aiError: '',
    records: [] as FridgeRecord[],
    recordsLoading: false,
    recordsLoaded: false,
    recordsError: '',
    recordsHasMore: false,
  },

  stockLoadSequence: 0,
  recordsLoadSequence: 0,
  aiSequence: 0,
  recordsCursor: '',
  writeKey: '',
  writeRequestId: '',

  async onShow() {
    await this.refresh()
  },

  async onPullDownRefresh() {
    try {
      await this.refresh()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  async refresh() {
    if (this.data.saving) return
    this.clearSuggestions()
    await Promise.all([this.loadBatches(), this.loadRecords()])
  },

  async loadBatches() {
    const sequence = ++this.stockLoadSequence
    this.setData({ loading: true, loadError: '' })
    try {
      if (!await hasFamily() || sequence !== this.stockLoadSequence) return
      const allBatches = await fridgeModule.listBatches()
      if (sequence !== this.stockLoadSequence) return
      const batches = allBatches.filter((batch) => batch.remaining)
      this.setData({
        batches,
        availableCount: batches.filter((batch) => batch.usable).length,
      })
    } catch (error: unknown) {
      if (sequence === this.stockLoadSequence) {
        this.setData({ loadError: toAppError(error).message })
      }
    } finally {
      if (sequence === this.stockLoadSequence) this.setData({ loading: false })
    }
  },

  async loadRecords() {
    await this.fetchRecords(false)
  },

  async moreRecords() {
    if (this.data.recordsLoading || !this.data.recordsHasMore) return
    await this.fetchRecords(true)
  },

  async fetchRecords(append: boolean) {
    const sequence = ++this.recordsLoadSequence
    const cursor = append ? this.recordsCursor : undefined
    this.setData({ recordsLoading: true, recordsError: '' })
    try {
      if (!await hasFamily() || sequence !== this.recordsLoadSequence) return
      const result = await fridgeModule.listRecords(cursor)
      if (sequence !== this.recordsLoadSequence) return
      const records = append ? [...this.data.records] : [] as FridgeRecord[]
      const existing = new Set(records.map((record) => record.id))
      result.records.forEach((record) => {
        if (!existing.has(record.id)) {
          records.push(record)
          existing.add(record.id)
        }
      })
      this.recordsCursor = result.nextCursor
      this.setData({ records, recordsLoaded: true, recordsHasMore: !!result.nextCursor })
    } catch (error: unknown) {
      if (sequence === this.recordsLoadSequence) {
        this.setData({ recordsError: toAppError(error).message })
      }
    } finally {
      if (sequence === this.recordsLoadSequence) this.setData({ recordsLoading: false })
    }
  },

  clearSuggestions() {
    ++this.aiSequence
    this.setData({ suggestions: [], aiLoading: false, aiLoaded: false, aiError: '' })
  },

  async suggest() {
    if (this.data.aiLoading || this.data.saving || this.data.loading) return
    const sequence = ++this.aiSequence
    this.setData({ aiLoading: true, aiLoaded: false, aiError: '', suggestions: [] })
    try {
      if (!await hasFamily() || sequence !== this.aiSequence) return
      const suggestions = await fridgeModule.suggest()
      if (sequence !== this.aiSequence) return
      this.setData({ suggestions, aiLoaded: true })
    } catch (error: unknown) {
      if (sequence === this.aiSequence) {
        this.setData({ aiError: toAppError(error).message, aiLoaded: true })
      }
    } finally {
      if (sequence === this.aiSequence) this.setData({ aiLoading: false })
    }
  },

  resetWriteIntent() {
    this.writeKey = ''
    this.writeRequestId = ''
  },

  requestIdFor(key: string) {
    if (key !== this.writeKey) {
      this.writeKey = key
      this.writeRequestId = createRequestId()
    }
    return this.writeRequestId
  },

  openAdd() {
    if (this.data.saving) return
    this.resetWriteIntent()
    this.setData({
      editorVisible: true, editingId: '', editingVersion: 0,
      formName: '', formExpiry: '', discardId: '', saveError: '',
    })
  },

  openEdit(event: BatchEvent) {
    if (this.data.saving) return
    const batch = this.data.batches.find((item) => item.id === event.currentTarget.dataset.id)
    if (!batch) return
    this.resetWriteIntent()
    this.setData({
      editorVisible: true, editingId: batch.id, editingVersion: batch.version,
      formName: batch.name, formExpiry: batch.expiresOn, discardId: '', saveError: '',
    })
  },

  closeEditor() {
    if (this.data.saving) return
    this.resetWriteIntent()
    this.setData({ editorVisible: false, editingId: '', formName: '', formExpiry: '', saveError: '' })
  },

  inputName(event: ValueEvent) {
    if (this.data.saving || event.detail.value === this.data.formName) return
    this.resetWriteIntent()
    this.setData({ formName: event.detail.value, saveError: '' })
  },

  changeExpiry(event: ValueEvent) {
    if (this.data.saving || event.detail.value === this.data.formExpiry) return
    this.resetWriteIntent()
    this.setData({ formExpiry: event.detail.value, saveError: '' })
  },

  clearExpiry() {
    if (this.data.saving || !this.data.formExpiry) return
    this.resetWriteIntent()
    this.setData({ formExpiry: '', saveError: '' })
  },

  async saveBatch() {
    if (this.data.saving || !this.data.editorVisible) return
    const name = this.data.formName.trim()
    if (!name) {
      this.setData({ saveError: '请填写食材名称' })
      return
    }
    const input = { name, expiresOn: this.data.formExpiry }
    const editingId = this.data.editingId
    const updateInput = { ...input, batchId: editingId, expectedVersion: this.data.editingVersion }
    const requestId = this.requestIdFor(JSON.stringify({
      action: editingId ? 'update' : 'create', input: editingId ? updateInput : input,
    }))
    this.setData({ saving: true, saveError: '' })
    this.clearSuggestions()
    try {
      if (!await hasFamily()) return
      if (editingId) await fridgeModule.updateBatch(updateInput, requestId)
      else await fridgeModule.createBatch(input, requestId)
      this.resetWriteIntent()
      this.setData({ editorVisible: false, editingId: '', formName: '', formExpiry: '' })
      this.clearSuggestions()
      await Promise.all([this.loadBatches(), this.loadRecords()])
    } catch (error: unknown) {
      this.setData({ saveError: toAppError(error).message })
    } finally {
      this.setData({ saving: false })
    }
  },

  discardBatch(event: BatchEvent) {
    if (this.data.saving) return
    const batch = this.data.batches.find((item) => item.id === event.currentTarget.dataset.id)
    if (!batch) return
    this.resetWriteIntent()
    this.setData({
      editorVisible: false, editingId: '', discardId: batch.id, discardVersion: batch.version,
      discardName: batch.name, discardReasonIndex: batch.expired ? 0 : 2,
      discardUsedUp: true, saveError: '',
    })
  },

  closeDiscard() {
    if (this.data.saving) return
    this.resetWriteIntent()
    this.setData({ discardId: '', saveError: '' })
  },

  changeDiscardReason(event: ValueEvent) {
    if (this.data.saving) return
    const index = Number(event.detail.value)
    if (!Number.isInteger(index) || !DISCARD_REASONS[index] || index === this.data.discardReasonIndex) return
    this.resetWriteIntent()
    this.setData({ discardReasonIndex: index, saveError: '' })
  },

  changeDiscardUsedUp(event: CheckboxEvent) {
    if (this.data.saving) return
    const usedUp = event.detail.value.includes('usedUp')
    if (usedUp === this.data.discardUsedUp) return
    this.resetWriteIntent()
    this.setData({ discardUsedUp: usedUp, saveError: '' })
  },

  async confirmDiscard() {
    if (this.data.saving || !this.data.discardId) return
    const input = {
      batchId: this.data.discardId,
      expectedVersion: this.data.discardVersion,
      reason: DISCARD_REASONS[this.data.discardReasonIndex],
      usedUp: this.data.discardUsedUp,
    }
    if (!input.reason) return
    const requestId = this.requestIdFor(JSON.stringify({ action: 'discard', input }))
    this.setData({ saving: true, saveError: '' })
    this.clearSuggestions()
    try {
      if (!await hasFamily()) return
      await fridgeModule.discardBatch(input, requestId)
      this.resetWriteIntent()
      this.setData({ discardId: '' })
      this.clearSuggestions()
      await Promise.all([this.loadBatches(), this.loadRecords()])
    } catch (error: unknown) {
      this.setData({ saveError: toAppError(error).message })
    } finally {
      this.setData({ saving: false })
    }
  },
})
