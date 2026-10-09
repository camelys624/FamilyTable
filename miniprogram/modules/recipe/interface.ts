import { Recipe } from '../../models/types'

export type IngredientConfidence = 'high' | 'medium' | 'low'

export interface IngredientSuggestion {
  name: string
  amount: number | null
  unit: string
  amountText: string
  evidenceStepIndexes: number[]
  evidenceQuotes: string[]
  confidence: IngredientConfidence
}

export interface IngredientUpdateSuggestion {
  existing: IngredientSuggestion
  suggested: IngredientSuggestion
  reason: string
}

export interface IngredientExtractionInput {
  steps: string[]
  existingIngredients: Array<{
    name: string
    amount: number | null
    unit: string
  }>
}

export interface IngredientExtractionResult {
  detected: IngredientSuggestion[]
  diff: {
    add: IngredientSuggestion[]
    update: IngredientUpdateSuggestion[]
    removeCandidates: IngredientSuggestion[]
    needsQuantity: IngredientSuggestion[]
  }
  warnings: string[]
}

export interface RecipeListInput {
  keyword?: string
  category?: string
}

export interface RecipeModule {
  listRecipes(input?: RecipeListInput): Promise<Recipe[]>
  getRecipe(recipeId: string): Promise<Recipe | null>
  createRecipe(recipe: Recipe): Promise<Recipe>
  updateRecipe(recipe: Recipe): Promise<Recipe>
  deleteRecipe(recipeId: string): Promise<void>
  extractIngredients(input: IngredientExtractionInput): Promise<IngredientExtractionResult>
}
