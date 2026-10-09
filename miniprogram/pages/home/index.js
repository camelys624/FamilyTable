"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../../modules/menu/index");
const index_2 = require("../../modules/recipe/index");
const date_1 = require("../../utils/date");
const store_1 = require("../../services/store");
const index_3 = require("../../modules/session/index");
const app_error_1 = require("../../utils/app-error");
Page({
    data: {
        familyName: '',
        userName: '',
        todayText: '',
        todayDishes: [],
        pollCandidates: [],
        votedRecipeId: '',
        remainingShopping: 0,
        shoppingStale: false,
        loadError: '',
    },
    async onShow() {
        await this.loadData();
    },
    async onPullDownRefresh() {
        await this.loadData();
        wx.stopPullDownRefresh();
    },
    async loadData() {
        const session = await (0, index_3.ensureSession)().catch((error) => {
            const message = (0, app_error_1.toAppError)(error).message;
            this.setData({ loadError: message });
            wx.showToast({ title: message, icon: 'none' });
            return null;
        });
        if (!session)
            return;
        if (!session.onboarded) {
            wx.reLaunch({ url: '/pages/onboarding/index' });
            return;
        }
        const state = (0, store_1.getState)();
        const userName = session.userName || state.userName;
        try {
            const [menu, recipes] = await Promise.all([
                index_1.menuModule.getWeekMenu((0, date_1.getCurrentWeekKey)()),
                index_2.recipeModule.listRecipes(),
            ]);
            const todayIndex = (new Date().getDay() || 7) - 1;
            const day = menu.days[todayIndex] || menu.days[0];
            if (!day)
                return;
            const emojiByTone = {
                tomato: '🍅',
                berry: '🍖',
                green: '🥬',
                grain: '🥣',
                ocean: '🐟',
            };
            const makeDishes = (items, mealLabel) => items.map((item) => ({
                ...item.recipe,
                mealLabel,
                foodEmoji: emojiByTone[item.recipe.tone] || '🍲',
            }));
            const breakfast = makeDishes(day.breakfast, '早')[0] || null;
            const lunch = makeDishes(day.lunch, '午');
            const dinner = makeDishes(day.dinner, '晚');
            const plannedDishes = [
                breakfast,
                lunch[0],
                dinner[0],
                lunch[1] || dinner[1],
            ].filter(Boolean);
            const todayDishes = plannedDishes.slice(0, 4);
            if (todayDishes.length < 4) {
                const plannedIds = new Set(todayDishes.map((dish) => dish.id));
                recipes.forEach((recipe) => {
                    if (todayDishes.length < 4 && !plannedIds.has(recipe.id)) {
                        todayDishes.push({
                            ...recipe,
                            mealLabel: '荐',
                            foodEmoji: emojiByTone[recipe.tone] || '🍲',
                        });
                        plannedIds.add(recipe.id);
                    }
                });
            }
            this.setData({
                familyName: session.familyName || state.familyName,
                userName,
                todayText: (0, date_1.formatToday)(),
                todayDishes,
                pollCandidates: recipes.slice(0, 3),
                votedRecipeId: state.votedRecipeId,
                remainingShopping: state.shoppingItems.filter((item) => !item.checked).length,
                shoppingStale: (0, store_1.isShoppingListStale)(),
                loadError: '',
            });
        }
        catch (error) {
            const message = (0, app_error_1.toAppError)(error).message;
            this.setData({ loadError: message });
            wx.showToast({ title: message, icon: 'none' });
        }
    },
    async retryLoad() {
        await this.loadData();
    },
    openWeekMenu() {
        wx.switchTab({ url: '/pages/menu/index' });
    },
    openFridge() {
        wx.navigateTo({ url: '/pages/fridge/index' });
    },
    openVote() {
        wx.navigateTo({ url: '/pages/vote/index' });
    },
    openShopping() {
        const state = (0, store_1.getState)();
        if (!state.shoppingItems.length)
            (0, store_1.generateShoppingList)();
        wx.switchTab({ url: '/pages/shopping/index' });
    },
});
