import { runtimeConfig } from '../../config/runtime'
import { createWxCloudClient } from '../../repositories/cloud-client'
import { CloudRecipeAdapter } from './cloud-adapter'
import { RecipeModule } from './interface'
import { LocalRecipeAdapter } from './local-adapter'

function createRecipeModule(): RecipeModule {
  if (runtimeConfig.repositoryMode === 'cloud') return new CloudRecipeAdapter(createWxCloudClient())
  return new LocalRecipeAdapter()
}

export const recipeModule = createRecipeModule()

export * from './interface'
