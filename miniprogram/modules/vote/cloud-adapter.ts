import { CloudClient } from '../../repositories/cloud-client'
import { MealType } from '../../models/types'
import { CreatePollInput, VoteModule, VoteResult } from './interface'
export class CloudVoteAdapter implements VoteModule {
  constructor(private readonly client: CloudClient) {}
  getCurrent(targetDate: string, mealType: MealType) { return this.client.call<VoteResult>('vote', 'vote.current', { targetDate, mealType }) }
  createPoll(input: CreatePollInput, requestId: string) { return this.client.call('vote', 'vote.createPoll', { ...input }, requestId) }
  cast(pollId: string, candidateRecipeId: string, requestId: string) { return this.client.call('vote', 'vote.cast', { pollId, candidateRecipeId }, requestId) }
  close(pollId: string, requestId: string) { return this.client.call('vote', 'vote.close', { pollId }, requestId) }
}
