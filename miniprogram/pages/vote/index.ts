import { MealType, Recipe } from '../../models/types'
import { voteModule, VoteResult } from '../../modules/vote/index'
import { recipeModule } from '../../modules/recipe/index'
import { toRecipe } from '../../modules/recipe/cloud-adapter'
import { ensureSession } from '../../modules/session/index'
import { getFamilyToday } from '../../utils/date'
import { toAppError } from '../../utils/app-error'
import { WriteIntent } from '../../utils/write-intent'

Page({
  data: { candidates: [] as Array<Recipe & { votes: number; percent: number; selected: boolean }>, votedRecipeId: '', totalVotes: 0, participantCount: 0, voters: [] as Array<{ id: string; name: string; initial: string; tone: string }>, pollId: '', pollTitle: '', status: '', deadline: '', canCreate: false, loading: false, saving: false, loadError: '', writeError: '', pending: false, showCreate: false, createCandidates: [] as Array<Recipe & { selected: boolean }>, title: '一起商量这顿吃什么', targetDate: '', mealType: 'dinner' as MealType, mealIndex: 2, mealNames: ['早餐', '午餐', '晚餐'], closeTime: '23:59' },
  writer: new WriteIntent(),
  async onShow() { await this.loadData() },
  async onPullDownRefresh() { await this.loadData(); wx.stopPullDownRefresh() },
  async loadData() {
    if (this.data.loading || this.data.saving) return
    this.setData({ loading: true, loadError: '', targetDate: this.data.targetDate || getFamilyToday() })
    try {
      const session = await ensureSession()
      if (!session.onboarded) { wx.reLaunch({ url: '/pages/onboarding/index' }); return }
      const [result, recipes] = await Promise.all([voteModule.getCurrent(this.data.targetDate, this.data.mealType), recipeModule.listRecipes()])
      const selected = new Set(this.data.createCandidates.filter((recipe) => recipe.selected).map((recipe) => recipe.id))
      this.setData({ createCandidates: recipes.map((recipe) => ({ ...recipe, selected: selected.has(recipe.id) })) })
      this.renderResult(result)
    } catch (error) { this.setData({ loadError: toAppError(error).message }) }
    finally { this.setData({ loading: false }) }
  },
  renderResult(result: VoteResult) {
    const candidates = (result.poll?.candidates || []).map((entry) => ({ ...toRecipe({ ...entry.recipeSnapshot, id: entry.recipeId, duration: 20 }), votes: result.summary.candidates.find((candidate) => candidate.recipeId === entry.recipeId)?.voteCount || 0, percent: 0, selected: result.currentVote?.candidateRecipeId === entry.recipeId }))
    candidates.forEach((candidate) => { candidate.percent = result.summary.totalVotes ? Math.round(candidate.votes / result.summary.totalVotes * 100) : 0 })
    const closesAt = result.poll ? new Date(new Date(result.poll.closesAt).getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : ''
    const tones = ['voter-one', 'voter-two', 'voter-three']
    const voters = result.voters.map((voter, index) => ({ id: voter.id, name: voter.displayName, initial: voter.displayName.slice(0, 1), tone: tones[index % tones.length] }))
    this.setData({ candidates, voters, votedRecipeId: result.currentVote?.candidateRecipeId || '', totalVotes: result.summary.totalVotes, participantCount: voters.length, pollId: result.poll?.id || '', pollTitle: result.poll?.title || '一起商量吃什么', status: result.poll?.status || '', deadline: closesAt ? `${closesAt} 截止（北京时间）` : '家长发起投票，家人一人一票。', canCreate: result.canCreate, showCreate: this.data.showCreate || (!result.poll && result.canCreate) })
  },
  blocked() { return this.data.loading || this.data.saving || this.data.pending || Boolean(this.data.loadError) },
  async vote(event: any) {
    if (this.blocked()) return
    if (this.data.status !== 'open') { wx.showToast({ title: '投票已结束', icon: 'none' }); return }
    if (this.data.votedRecipeId) { wx.showToast({ title: '每人只能投一票', icon: 'none' }); return }
    await this.write('cast', { pollId: this.data.pollId, candidateRecipeId: event.currentTarget.dataset.id })
  },
  openCreate() { if (!this.blocked() && this.data.canCreate) this.setData({ showCreate: true }) },
  toggleCandidate(event: any) {
    if (this.blocked()) return
    const candidates = this.data.createCandidates.map((recipe) => recipe.id === event.currentTarget.dataset.id ? { ...recipe, selected: !recipe.selected } : recipe)
    if (candidates.filter((recipe) => recipe.selected).length > 10) { wx.showToast({ title: '最多选择 10 道菜', icon: 'none' }); return }
    this.setData({ createCandidates: candidates })
  },
  onTitle(event: any) { if (!this.blocked()) this.setData({ title: event.detail.value }) },
  onCloseTime(event: any) { if (!this.blocked()) this.setData({ closeTime: event.detail.value }) },
  async onTargetDate(event: any) { if (!this.blocked()) { this.setData({ targetDate: event.detail.value }); await this.loadData() } },
  async onMeal(event: any) { if (!this.blocked()) { const mealIndex = Number(event.detail.value); this.setData({ mealIndex, mealType: (['breakfast', 'lunch', 'dinner'] as MealType[])[mealIndex] }); await this.loadData() } },
  async createPoll() {
    if (this.blocked() || !this.data.canCreate) return
    const candidateRecipeIds = this.data.createCandidates.filter((recipe) => recipe.selected).map((recipe) => recipe.id)
    if (candidateRecipeIds.length < 2) { wx.showToast({ title: '至少选择两道菜', icon: 'none' }); return }
    await this.write('createPoll', { title: this.data.title.trim(), targetDate: this.data.targetDate, mealType: this.data.mealType, candidateRecipeIds, closesAt: new Date(`${this.data.targetDate}T${this.data.closeTime}:00+08:00`).toISOString() })
  },
  closePoll() {
    if (this.blocked() || !this.data.canCreate) return
    wx.showModal({ title: '结束当前投票？', content: '已投的票会保留，结束后家人不能继续投票。', confirmText: '结束投票', success: (result: any) => { if (result.confirm && !this.blocked()) void this.write('close', { pollId: this.data.pollId }) } })
  },
  async invoke(action: string, input: any, requestId: string) {
    if (action === 'createPoll') return voteModule.createPoll(input, requestId)
    if (action === 'cast') return voteModule.cast(input.pollId, input.candidateRecipeId, requestId)
    return voteModule.close(input.pollId, requestId)
  },
  async write(action: string, input: Record<string, unknown>) {
    if (this.data.loading || this.data.saving) return
    this.setData({ saving: true, writeError: '' })
    try {
      await this.writer.run(action, input, (requestId) => this.invoke(action, input, requestId))
      this.setData({ pending: false, saving: false, ...(action === 'createPoll' ? { showCreate: false } : {}) })
      wx.showToast({ title: action === 'cast' ? '这一票记下了' : '投票已更新', icon: 'success' })
      await this.loadData()
    } catch (error) {
      const failure = toAppError(error)
      this.setData({ writeError: failure.message, pending: Boolean(this.writer.pending) })
      if (['POLL_CLOSED', 'VOTE_ALREADY_CAST', 'POLL_ALREADY_OPEN'].includes(failure.code)) { this.setData({ saving: false }); await this.loadData() }
    } finally { this.setData({ saving: false }) }
  },
  async retryPending() { const pending = this.writer.pending; if (pending) await this.write(pending.action, pending.input) },
  openRecipes() { wx.switchTab({ url: '/pages/recipes/index' }) },
})
