"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalMenuAdapter = void 0;
const app_error_1 = require("../../utils/app-error");
const store_1 = require("../../services/store");
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
function dayMeta(weekStart, index) {
    const date = new Date(`${weekStart}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return {
        key: date.toISOString().slice(0, 10),
        weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getUTCDay()],
        dateLabel: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
    };
}
function localItemId(date, mealType, index) {
    return `local|${date}|${mealType}|${index}`;
}
function itemView(recipe, date, mealType, index) {
    return { id: localItemId(date, mealType, index), recipeId: recipe.id, recipe, source: 'manual' };
}
class LocalMenuAdapter {
    async getWeekMenu(weekStart) {
        const state = (0, store_1.getState)();
        const storedDays = new Map(state.weekMenu.map((day) => [day.key, day]));
        const days = Array.from({ length: 7 }, (_, index) => {
            const meta = dayMeta(weekStart, index);
            const stored = storedDays.get(meta.key);
            const day = stored || { key: meta.key, breakfast: [], lunch: [], dinner: [] };
            return {
                ...meta,
                breakfast: this.mapItems(state.recipes, day.key, 'breakfast', day.breakfast),
                lunch: this.mapItems(state.recipes, day.key, 'lunch', day.lunch),
                dinner: this.mapItems(state.recipes, day.key, 'dinner', day.dinner),
            };
        });
        return { id: `local|${weekStart}`, weekStart, timezone: 'Asia/Shanghai', version: 0, days };
    }
    async addRecipe(input) {
        const state = (0, store_1.getState)();
        const dayIndex = state.weekMenu.findIndex((day) => day.key === input.date);
        if (dayIndex < 0)
            throw new app_error_1.AppError('NOT_FOUND', '菜单日期不存在');
        if (!state.recipes.some((recipe) => recipe.id === input.recipeId))
            throw new app_error_1.AppError('NOT_FOUND', '这道菜已经不在菜谱簿里了');
        (0, store_1.addRecipeToMenu)(dayIndex, input.mealType, input.recipeId);
        return this.getWeekMenu(input.weekStart);
    }
    async removeRecipe(input) {
        const state = (0, store_1.getState)();
        for (let dayIndex = 0; dayIndex < state.weekMenu.length; dayIndex += 1) {
            const day = state.weekMenu[dayIndex];
            for (const mealType of MEAL_TYPES) {
                const recipeIndex = day[mealType].findIndex((recipeId, index) => localItemId(day.key, mealType, index) === input.itemId);
                if (recipeIndex >= 0) {
                    (0, store_1.removeRecipeFromMenu)(dayIndex, mealType, day[mealType][recipeIndex]);
                    return this.getWeekMenu(input.menuId.split('|')[1] || day.key);
                }
            }
        }
        throw new app_error_1.AppError('NOT_FOUND', '这道菜已经从菜单移除了');
    }
    mapItems(recipes, date, mealType, recipeIds) {
        return recipeIds.map((recipeId, index) => {
            const recipe = recipes.find((item) => item.id === recipeId);
            return recipe ? itemView(recipe, date, mealType, index) : null;
        }).filter(Boolean);
    }
}
exports.LocalMenuAdapter = LocalMenuAdapter;
