import { Ingredient, Recipe } from '../../models/types'
import { CloudClient } from '../../repositories/cloud-client'
import { IngredientExtractionInput, IngredientExtractionResult, RecipeListInput, RecipeModule } from './interface'

interface RemoteIngredientSuggestion {
  name: string
  quantity: number | null
  unit: string
  quantityText: string
  evidenceStepIndexes: number[]
  evidenceQuotes: string[]
  confidence: 'high' | 'medium' | 'low'
}

interface RemoteIngredientUpdate {
  existing: RemoteIngredientSuggestion
  suggested: RemoteIngredientSuggestion
  reason: string
}

interface RemoteIngredientExtractionResult {
  detected: RemoteIngredientSuggestion[]
  diff: {
    add: RemoteIngredientSuggestion[]
    update: RemoteIngredientUpdate[]
    removeCandidates: RemoteIngredientSuggestion[]
    needsQuantity: RemoteIngredientSuggestion[]
  }
  warnings: string[]
}

interface RemoteRecipe {
  id: string
  name: string
  category: string
  duration: number
  durationMinutes?: number
  difficulty: string
  note?: string
  ingredients: Ingredient[]
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
function toIngredientSuggestion(remote: RemoteIngredientSuggestion) {
  return {
    name: remote.name,
    amount: remote.quantity === null || remote.quantity === undefined ? null : Number(remote.quantity),
    unit: remote.unit || '',
    amountText: remote.quantityText || '',
    evidenceStepIndexes: remote.evidenceStepIndexes || [],
    evidenceQuotes: remote.evidenceQuotes || [],
    confidence: remote.confidence || 'low',
  }
}

function toIngredientExtractionResult(remote: RemoteIngredientExtractionResult): IngredientExtractionResult {
  return {
    detected: (remote.detected || []).map(toIngredientSuggestion),
    diff: {
      add: (remote.diff?.add || []).map(toIngredientSuggestion),
      update: (remote.diff?.update || []).map((item) => ({
        existing: toIngredientSuggestion(item.existing),
        suggested: toIngredientSuggestion(item.suggested),
        reason: item.reason || '',
      })),
      removeCandidates: (remote.diff?.removeCandidates || []).map(toIngredientSuggestion),
      needsQuantity: (remote.diff?.needsQuantity || []).map(toIngredientSuggestion),
    },
    warnings: remote.warnings || [],
  }
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
      usedUp: ingredient.usedUp,
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
      usedUp: ingredient.usedUp,
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

  async extractIngredients(input: IngredientExtractionInput) {
    const result = await this.client.call<RemoteIngredientExtractionResult>('recipe', 'recipe.extractIngredients', {
      steps: input.steps,
      existingIngredients: input.existingIngredients.map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.amount,
        unit: ingredient.unit,
      })),
    })
    return toIngredientExtractionResult(result)
  }

  async deleteRecipe(recipeId: string) {
    await this.client.call('recipe', 'recipe.delete', { recipeId })
  }
}

export { toRecipe, toDraft, toneForRecipe, toIngredientExtractionResult }
