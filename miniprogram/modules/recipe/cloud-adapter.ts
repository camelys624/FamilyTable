import { Recipe } from '../../models/types'
import { CloudClient } from '../../repositories/cloud-client'
import { RecipeListInput, RecipeModule } from './interface'

interface RemoteIngredient {
  name: string
  quantity: number
  unit: string
}

interface RemoteRecipe {
  id: string
  name: string
  category: string
  duration: number
  durationMinutes?: number
  difficulty: string
  note?: string
  ingredients: RemoteIngredient[]
  steps?: string[]
  imagePath?: string
}

interface RecipeListResult {
  items: RemoteRecipe[]
  nextCursor?: string
}

interface RecipeResult {
  recipe: RemoteRecipe
}

const difficultyToRemote: Record<string, string> = {
  简单: 'easy',
  适中: 'medium',
  困难: 'hard',
  '费点功夫': 'hard',
}

function toneForRecipe(id: string) {
  const tones = ['green', 'tomato', 'ocean', 'grain', 'berry']
  let value = 0
  for (const character of id) value = (value * 31 + character.charCodeAt(0)) >>> 0
  return tones[value % tones.length]
}

function toRecipe(remote: RemoteRecipe): Recipe {
  return {
    id: remote.id,
    name: remote.name,
    initial: remote.name.slice(0, 1),
    imagePath: remote.imagePath || '',
    category: remote.category,
    duration: remote.durationMinutes || remote.duration || 20,
    difficulty: ['easy', '简单'].includes(remote.difficulty)
      ? '简单'
      : ['medium', '适中'].includes(remote.difficulty)
        ? '适中'
        : '困难',
    tone: toneForRecipe(remote.id),
    note: remote.note || '',
    ingredients: (remote.ingredients || []).map((ingredient) => ({
      name: ingredient.name,
      amount: ingredient.quantity,
      unit: ingredient.unit,
    })),
    steps: remote.steps || [],
  }
}

function toDraft(recipe: Recipe) {
  return {
    name: recipe.name,
    category: recipe.category,
    durationMinutes: recipe.duration,
    difficulty: difficultyToRemote[recipe.difficulty] || 'easy',
    note: recipe.note,
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.amount,
      unit: ingredient.unit,
    })),
    steps: recipe.steps,
  }
}

export class CloudRecipeAdapter implements RecipeModule {
  constructor(private readonly client: CloudClient) {}

  async listRecipes(input: RecipeListInput = {}) {
    const result = await this.client.call<RecipeListResult>('recipe', 'recipe.list', {
      keyword: input.keyword || '',
      category: input.category || '',
      pageSize: 100,
    })
    return result.items.map(toRecipe)
  }

  async getRecipe(recipeId: string) {
    const result = await this.client.call<RecipeResult>('recipe', 'recipe.detail', { recipeId })
    return toRecipe(result.recipe)
  }

  async createRecipe(recipe: Recipe) {
    const result = await this.client.call<RecipeResult>('recipe', 'recipe.create', toDraft(recipe))
    return { ...toRecipe(result.recipe), imagePath: recipe.imagePath || '' }
  }

  async updateRecipe(recipe: Recipe) {
    const result = await this.client.call<RecipeResult>('recipe', 'recipe.update', {
      recipeId: recipe.id,
      patch: toDraft(recipe),
    })
    return { ...toRecipe(result.recipe), imagePath: recipe.imagePath || '' }
  }

  async deleteRecipe(recipeId: string) {
    await this.client.call('recipe', 'recipe.delete', { recipeId })
  }
}

export { toRecipe, toDraft, toneForRecipe }
