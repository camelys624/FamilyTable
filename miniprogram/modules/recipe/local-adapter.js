"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalRecipeAdapter = void 0;
const app_error_1 = require("../../utils/app-error");
const store_1 = require("../../services/store");
class LocalRecipeAdapter {
    async listRecipes(input = {}) {
        const keyword = (input.keyword || '').trim().toLocaleLowerCase();
        const recipes = (0, store_1.getState)().recipes;
        return recipes.filter((recipe) => {
            const categoryMatched = !input.category || recipe.category === input.category;
            const keywordMatched = !keyword || recipe.name.toLocaleLowerCase().includes(keyword);
            return categoryMatched && keywordMatched;
        });
    }
    async getRecipe(recipeId) {
        return (0, store_1.findRecipe)(recipeId) || null;
    }
    async createRecipe(recipe) {
        (0, store_1.addRecipe)(recipe);
        return recipe;
    }
    async updateRecipe(recipe) {
        if (!(0, store_1.updateRecipe)(recipe))
            throw new app_error_1.AppError('NOT_FOUND', '这道菜已经不在菜谱簿里了');
        return recipe;
    }
    async deleteRecipe(recipeId) {
        if (!(0, store_1.deleteRecipe)(recipeId))
            throw new app_error_1.AppError('NOT_FOUND', '这道菜已经不在菜谱簿里了');
    }
}
exports.LocalRecipeAdapter = LocalRecipeAdapter;
