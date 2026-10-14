import { MealType, Recipe } from '../../models/types'

export interface Poll {
  id: string
  title: string
  targetDate: string
  mealType: MealType
  status: 'open' | 'closed'
  closesAt: string
  candidates: Array<{ recipeId: string; recipeSnapshot: { name: string; category: string; durationMinutes?: number; difficulty: string; note: string; ingredients: Recipe['ingredients'] } }>
}
export interface VoteResult {
  poll: Poll | null
  summary: { totalVotes: number; candidates: Array<{ recipeId: string; voteCount: number }>; currentMemberVoted: boolean }
  currentVote: { candidateRecipeId: string } | null
  voters: Array<{ id: string; displayName: string }>
  canCreate: boolean
}
export interface CreatePollInput { title: string; targetDate: string; mealType: MealType; candidateRecipeIds: string[]; closesAt: string }
export interface VoteModule {
  getCurrent(targetDate: string, mealType: MealType): Promise<VoteResult>
  createPoll(input: CreatePollInput, requestId: string): Promise<unknown>
  cast(pollId: string, candidateRecipeId: string, requestId: string): Promise<unknown>
  close(pollId: string, requestId: string): Promise<unknown>
}
