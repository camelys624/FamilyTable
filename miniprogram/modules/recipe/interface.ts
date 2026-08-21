import { Recipe } from '../../models/types'

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
}
