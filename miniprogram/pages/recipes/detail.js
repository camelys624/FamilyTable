"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const menu_1 = require("../../modules/menu/index");
const recipe_1 = require("../../modules/recipe/index");
const date_1 = require("../../utils/date");
Page({
    data: {
        recipeId: '',
        recipe: null,
        usageCount: 0,
    },
    onLoad(options) {
        if (!options.id) {
            wx.navigateBack();
            return;
        }
        this.setData({ recipeId: options.id });
    },
    async onShow() {
        const recipeId = this.data.recipeId;
        if (!recipeId)
            return;
        try {
            const recipe = await recipe_1.recipeModule.getRecipe(recipeId);
            if (!recipe) {
                wx.showToast({ title: '这道菜已经不在菜谱簿里了', icon: 'none' });
                setTimeout(() => wx.navigateBack(), 450);
                return;
            }
            const menu = await menu_1.menuModule.getWeekMenu((0, date_1.getCurrentWeekKey)());
            const usageCount = menu.days.reduce((total, day) => {
                return total + ['breakfast', 'lunch', 'dinner'].reduce((dayTotal, mealType) => {
                    return dayTotal + day[mealType].filter((item) => item.recipeId === recipeId).length;
                }, 0);
            }, 0);
            this.setData({ recipe, usageCount });
            wx.setNavigationBarTitle({ title: recipe.name });
        }
        catch (error) {
            wx.showToast({ title: error instanceof Error ? error.message : '菜谱暂时加载失败，请重试', icon: 'none' });
        }
    },
    editRecipe() {
        if (!this.data.recipe)
            return;
        wx.navigateTo({ url: `/pages/recipes/edit?id=${this.data.recipe.id}` });
    },
    deleteRecipe() {
        const recipe = this.data.recipe;
        if (!recipe)
            return;
        const usageNote = this.data.usageCount
            ? `它已出现在本周菜单 ${this.data.usageCount} 次，删除后会同时从本周菜单移除。`
            : '删除后无法恢复。';
        wx.showModal({
            title: `删除“${recipe.name}”？`,
            content: usageNote,
            confirmText: '删除菜谱',
            confirmColor: '#d94f3d',
            success: async (result) => {
                if (!result.confirm)
                    return;
                try {
                    await recipe_1.recipeModule.deleteRecipe(recipe.id);
                    wx.showToast({ title: '已从菜谱簿移除', icon: 'success' });
                    setTimeout(() => wx.navigateBack(), 450);
                }
                catch (error) {
                    wx.showToast({ title: error instanceof Error ? error.message : '删除失败，请重试', icon: 'none' });
                }
            },
        });
    },
});
