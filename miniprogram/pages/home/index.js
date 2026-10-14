"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../../modules/menu/index");
const index_2 = require("../../modules/recipe/index");
const date_1 = require("../../utils/date");
const index_3 = require("../../modules/vote/index");
const index_4 = require("../../modules/shopping/index");
const index_5 = require("../../modules/family/index");
const cloud_adapter_1 = require("../../modules/recipe/cloud-adapter");
const index_6 = require("../../modules/session/index");
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
        voteError: '',
        shoppingError: '',
        loadError: '',
        loading: true,
    },
    async onShow() {
        await this.loadData();
    },
    async onPullDownRefresh() {
        await this.loadData();
        wx.stopPullDownRefresh();
    },
    async loadData() {
        this.setData({ loading: true });
        const session = await (0, index_6.ensureSession)().catch((error) => {
            const message = (0, app_error_1.toAppError)(error).message;
            this.setData({ loadError: message });
            wx.showToast({ title: message, icon: 'none' });
            return null;
        });
        if (!session) {
            this.setData({ loading: false });
            return;
        }
        if (!session.onboarded) {
            this.setData({ loading: false });
            wx.reLaunch({ url: '/pages/onboarding/index' });
            return;
        }
        const userName = session.userName || '家人';
        try {
            const [menu, recipes, currentFamily] = await Promise.all([
                index_1.menuModule.getWeekMenu((0, date_1.getCurrentWeekKey)()),
                index_2.recipeModule.listRecipes(),
                index_5.familyModule.getCurrentFamily(),
            ]);
            const extras = await Promise.allSettled([index_3.voteModule.getCurrent((0, date_1.getFamilyToday)(), 'dinner'), index_4.shoppingModule.getList((0, date_1.getCurrentWeekKey)())]);
            const poll = extras[0].status === 'fulfilled' ? extras[0].value : null;
            const shopping = extras[1].status === 'fulfilled' ? extras[1].value : null;
            const todayIndex = (new Date(`${(0, date_1.getFamilyToday)()}T12:00:00Z`).getUTCDay() || 7) - 1;
            const day = menu.days[todayIndex] || menu.days[0];
            if (!day) {
                this.setData({ loading: false });
                return;
            }
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
                familyName: currentFamily.family.name,
                userName,
                todayText: (0, date_1.formatToday)(),
                todayDishes,
                pollCandidates: (poll?.poll?.candidates || []).map((entry) => (0, cloud_adapter_1.toRecipe)({ ...entry.recipeSnapshot, id: entry.recipeId, duration: 20 })),
                votedRecipeId: poll?.currentVote?.candidateRecipeId || '',
                remainingShopping: shopping?.items.filter((item) => !item.checked).length || 0,
                shoppingStale: shopping?.stale || false,
                voteError: extras[0].status === 'rejected' ? (0, app_error_1.toAppError)(extras[0].reason).message : '',
                shoppingError: extras[1].status === 'rejected' ? (0, app_error_1.toAppError)(extras[1].reason).message : '',
                loadError: '',
            });
        }
        catch (error) {
            const message = (0, app_error_1.toAppError)(error).message;
            this.setData({ loadError: message });
            wx.showToast({ title: message, icon: 'none' });
        }
        finally {
            this.setData({ loading: false });
        }
    },
    async retryLoad() {
        await this.loadData();
    },
    openWeekMenu() {
        wx.switchTab({ url: '/pages/menu/index' });
    },
    openVote() {
        wx.navigateTo({ url: '/pages/vote/index' });
    },
    openShopping() {
        wx.navigateTo({ url: '/pages/shopping/index' });
    },
});
