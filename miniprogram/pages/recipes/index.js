"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const recipe_1 = require("../../modules/recipe/index");
const app_error_1 = require("../../utils/app-error");
Page({
    data: {
        recipes: [],
        visibleRecipes: [],
        keyword: '',
        selectedCategory: '全部',
        categories: ['全部', '快手菜', '拿手菜', '素菜', '早餐', '家常菜'],
        loadError: '',
    },
    async onShow() {
        this.setData({ loadError: '' });
        try {
            const recipes = await recipe_1.recipeModule.listRecipes();
            this.setData({ recipes, loadError: '' });
            this.filterRecipes(recipes, this.data.keyword, this.data.selectedCategory);
        }
        catch (error) {
            const message = (0, app_error_1.toAppError)(error).message;
            this.setData({ loadError: message, recipes: [], visibleRecipes: [] });
            wx.showToast({ title: message, icon: 'none' });
        }
    },
    async retryLoad() {
        await this.onShow();
    },
    onSearch(event) {
        const keyword = event.detail.value;
        this.setData({ keyword });
        this.filterRecipes(this.data.recipes, keyword, this.data.selectedCategory);
    },
    selectCategory(event) {
        const selectedCategory = event.currentTarget.dataset.category;
        this.setData({ selectedCategory });
        this.filterRecipes(this.data.recipes, this.data.keyword, selectedCategory);
    },
    filterRecipes(recipes, keyword, category) {
        const normalized = keyword.trim().toLowerCase();
        const visibleRecipes = recipes.filter((recipe) => {
            const categoryMatched = category === '全部' || recipe.category === category;
            const keywordMatched = !normalized || recipe.name.toLowerCase().includes(normalized);
            return categoryMatched && keywordMatched;
        });
        this.setData({ visibleRecipes });
    },
    addRecipe() {
        wx.navigateTo({ url: '/pages/recipes/edit' });
    },
    showRecipe(event) {
        wx.navigateTo({ url: `/pages/recipes/detail?id=${event.currentTarget.dataset.id}` });
    },
});
