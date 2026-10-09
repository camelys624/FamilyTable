import { Recipe } from '../../models/types'
import { AppError } from '../../utils/app-error'
import { addRecipe as addLocalRecipe, deleteRecipe as deleteLocalRecipe, findRecipe, getState, updateRecipe as updateLocalRecipe } from '../../services/store'
import { IngredientExtractionInput, IngredientExtractionResult, RecipeListInput, RecipeModule } from './interface'

export class LocalRecipeAdapter implements RecipeModule {
  async listRecipes(input: RecipeListInput = {}) {
    const keyword = (input.keyword || '').trim().toLocaleLowerCase()
    const recipes = getState().recipes
    return recipes.filter((recipe) => {
      const categoryMatched = !input.category || recipe.category === input.category
      const keywordMatched = !keyword || recipe.name.toLocaleLowerCase().includes(keyword)
      return categoryMatched && keywordMatched
    })
  }

  async getRecipe(recipeId: string) {
    return findRecipe(recipeId) || null
  }

  async createRecipe(recipe: Recipe) {
    addLocalRecipe(recipe)
    return recipe
  }

  async updateRecipe(recipe: Recipe) {
    if (!updateLocalRecipe(recipe)) throw new AppError('NOT_FOUND', '这道菜已经不在菜谱簿里了')
    return recipe
  }

  async deleteRecipe(recipeId: string) {
    if (!deleteLocalRecipe(recipeId)) throw new AppError('NOT_FOUND', '这道菜已经不在菜谱簿里了')
  }
  async extractIngredients(_input: IngredientExtractionInput): Promise<IngredientExtractionResult> {
    throw new AppError('FEATURE_UNAVAILABLE', 'AI 整理需要连接云端，请继续手动填写')
  }
}
