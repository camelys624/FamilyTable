'use strict'

const { BaseRepository, codedError, get, hash, dataOnly, today } = require('./common')
const pollView = (poll) => ({ id: poll._id, title: poll.title, targetDate: poll.targetDate, mealType: poll.mealType, candidates: poll.candidates, closesAt: new Date(poll.closesAt).toISOString(), status: poll.status === 'open' && new Date(poll.closesAt).getTime() > Date.now() ? 'open' : 'closed' })
const voteView = (vote) => ({ id: vote._id, pollId: vote.pollId, candidateRecipeId: vote.candidateRecipeId })

class CloudBaseVoteRepository extends BaseRepository {
  async current(openid, input) {
    const context = await this.context(openid)
    const rows = await this.db.collection('polls').where({ familyId: context.familyId, targetDate: input.targetDate, mealType: input.mealType }).orderBy('createdAt', 'desc').limit(1).get()
    return rows.data[0] ? this.readResult(context, rows.data[0]) : { poll: null, summary: { totalVotes: 0, candidates: [], currentMemberVoted: false }, currentVote: null, voters: [], canCreate: context.member.role === 'owner' }
  }

  async result(openid, input) {
    const context = await this.context(openid)
    const poll = await get(this.db, 'polls', input.pollId)
    if (!poll || poll.familyId !== context.familyId) throw codedError('NOT_FOUND', '投票不存在或已不可访问')
    return this.readResult(context, poll)
  }

  async readResult(context, poll) {
    const rows = (await this.db.collection('votes').where({ familyId: context.familyId, pollId: poll._id }).limit(100).get()).data
    const currentVote = rows.find((row) => row.voterMemberId === context.member._id)
    const members = (await this.db.collection('family_members').where({ familyId: context.familyId, status: 'active' }).limit(100).get()).data
    return {
      poll: pollView(poll), canCreate: context.member.role === 'owner',
      summary: { totalVotes: rows.length, candidates: poll.candidates.map((candidate) => ({ recipeId: candidate.recipeId, voteCount: rows.filter((row) => row.candidateRecipeId === candidate.recipeId).length })), currentMemberVoted: Boolean(currentVote) },
      currentVote: currentVote ? voteView(currentVote) : null,
      voters: rows.map((row) => { const member = members.find((entry) => entry._id === row.voterMemberId); return { id: row.voterMemberId, displayName: member?.displayName || '已离开的家人' } }),
    }
  }

  async createPoll(openid, input, requestId) {
    const context = await this.context(openid)
    return this.write(context, 'vote.createPoll', input, requestId, async (transaction, now, current) => {
      if (current.member.role !== 'owner') throw codedError('FORBIDDEN', '只有管理员可以发起投票')
      const closesAt = new Date(input.closesAt)
      const targetOffset = (new Date(`${input.targetDate}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000
      if (closesAt <= now || closesAt.getTime() > now.getTime() + 7 * 86400000 || targetOffset < 0 || targetOffset > 6) throw codedError('VALIDATION_ERROR', '请选择未来七天内的用餐日期和截止时间')
      const slot = `${input.targetDate}_${input.mealType}`
      const activePolls = current.family.activePolls || {}
      const previous = activePolls[slot] ? await get(transaction, 'polls', activePolls[slot]) : null
      if (previous && pollView(previous).status === 'open') throw codedError('POLL_ALREADY_OPEN', '这顿饭已有开放投票，请先结束当前投票')
      const candidates = []
      for (const id of input.candidateRecipeIds) {
        const recipe = await get(transaction, 'recipes', id)
        if (!recipe || recipe.familyId !== current.familyId || recipe.deletedAt) throw codedError('NOT_FOUND', '候选菜已经不在当前家庭菜谱中')
        candidates.push({ recipeId: id, recipeSnapshot: { name: recipe.name, category: recipe.category, durationMinutes: recipe.durationMinutes, difficulty: recipe.difficulty, note: recipe.note || '', ingredients: recipe.ingredients || [] } })
      }
      const id = `poll_${hash(`${current.familyId}:${requestId}:${current.user._id}`).slice(0, 40)}`
      const poll = { _id: id, familyId: current.familyId, ...input, candidateRecipeIds: undefined, candidates, closesAt, status: 'open', createdAt: now, createdBy: current.user._id, updatedAt: now, updatedBy: current.user._id, schemaVersion: 1 }
      delete poll.candidateRecipeIds
      await transaction.collection('polls').doc(id).set({ data: dataOnly(poll) })
      const nextSlots = Object.fromEntries(Object.entries(activePolls).filter(([key]) => key.slice(0, 10) >= today()))
      nextSlots[slot] = id
      await transaction.collection('families').doc(current.familyId).update({ data: { activePolls: nextSlots, updatedAt: now, updatedBy: current.user._id } })
      return { poll: pollView(poll) }
    })
  }

  async cast(openid, input, requestId) {
    const context = await this.context(openid)
    const receipt = await this.write(context, 'vote.cast', input, requestId, async (transaction, now, current) => {
      const poll = await get(transaction, 'polls', input.pollId)
      if (!poll || poll.familyId !== current.familyId) throw codedError('NOT_FOUND', '投票不存在或已不可访问')
      if (pollView(poll).status !== 'open') throw codedError('POLL_CLOSED', '投票已结束')
      if (!poll.candidates.some((candidate) => candidate.recipeId === input.candidateRecipeId)) throw codedError('VALIDATION_ERROR', '请选择当前投票中的菜')
      const id = `vote_${hash(`${poll._id}:${current.member._id}`).slice(0, 40)}`
      if (await get(transaction, 'votes', id)) throw codedError('VOTE_ALREADY_CAST', '每人只能投一票')
      const vote = { _id: id, familyId: current.familyId, pollId: poll._id, voterMemberId: current.member._id, voterUserId: current.user._id, candidateRecipeId: input.candidateRecipeId, createdAt: now, createdBy: current.user._id, updatedAt: now, updatedBy: current.user._id, schemaVersion: 1 }
      await transaction.collection('votes').doc(id).set({ data: dataOnly(vote) })
      return { vote: voteView(vote) }
    })
    const result = await this.result(openid, { pollId: input.pollId })
    return { ...receipt, summary: result.summary }
  }

  async close(openid, input, requestId) {
    const context = await this.context(openid)
    return this.write(context, 'vote.close', input, requestId, async (transaction, now, current) => {
      if (current.member.role !== 'owner') throw codedError('FORBIDDEN', '只有管理员可以结束投票')
      const poll = await get(transaction, 'polls', input.pollId)
      if (!poll || poll.familyId !== current.familyId) throw codedError('NOT_FOUND', '投票不存在或已不可访问')
      await transaction.collection('polls').doc(poll._id).update({ data: { status: 'closed', updatedAt: now, updatedBy: current.user._id } })
      return { poll: pollView({ ...poll, status: 'closed' }) }
    })
  }
}

module.exports = { CloudBaseVoteRepository, pollView }
