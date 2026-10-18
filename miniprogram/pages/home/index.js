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
function dishView(recipe, mealLabel, displayKey, suggested = false) {
    const food = `${recipe.name} ${recipe.ingredients.map((item) => item.name).join(' ')}`;
    let artKind = '';
    if (/汤|粥|羹/.test(recipe.name))
        artKind = 'soup';
    else if (/鱼|鲈|鲫|鲳/.test(food))
        artKind = 'fish';
    else if (/番茄.*蛋|西红柿.*蛋/.test(recipe.name))
        artKind = 'eggsDish';
    else if (/菜心|青菜|小白菜|油麦菜|生菜|菠菜|空心菜/.test(food) && !/肉|虾|鸡(?!蛋)|鱼/.test(food))
        artKind = 'greensDish';
    const symbols = [
        [/排骨|小排|肋排|猪|牛肉|牛腩|牛排|羊肉|肉丸/, '🍖'], [/鸡(?!蛋)|鸭|鹅/, '🍗'], [/虾/, '🍤'],
        [/吐司|土司|面包/, '🍞'],
        [/面|粉|意面/, '🍜'], [/米|饭/, '🍚'], [/蛋/, '🍳'], [/豆腐|豆干/, '🫘'],
        [/茄子/, '🍆'], [/土豆/, '🥔'], [/菇|菌/, '🍄'], [/番茄|西红柿/, '🍅'], [/菜|笋|瓜/, '🥬'],
    ];
    const foodEmoji = (symbols.find(([pattern]) => pattern.test(recipe.name)) || symbols.find(([pattern]) => pattern.test(food)))?.[1] || '🍲';
    const foodSheetStyle = /虾.*(蒸蛋|豆腐.*蛋)/.test(recipe.name) ? 'left:0;' : /芋泥.*(吐司|土司)/.test(recipe.name) ? 'left:-100%;' : '';
    const ingredients = recipe.ingredients.slice(0, 2).map((item) => item.name).join(' · ');
    return {
        ...recipe, mealLabel, displayKey, artKind, foodEmoji, foodSheetStyle,
        subtitle: `${suggested ? '待安排 · ' : ''}${ingredients || recipe.category || '家常口味'} · ${recipe.duration} 分钟`,
    };
}
Page({
    data: {
        familyName: '',
        userName: '',
        greeting: '小厨师，开饭啦',
        navTop: 24,
        navHeight: 44,
        navRight: 100,
        todayText: '',
        todayDishes: [],
        pollCandidates: [],
        pollId: '',
        canCreatePoll: false,
        votedRecipeId: '',
        remainingShopping: 0,
        shoppingStale: false,
        voteError: '',
        shoppingError: '',
        loadError: '',
        loading: true,
    },
    onLoad() {
        const info = wx.getWindowInfo?.() || wx.getSystemInfoSync?.() || {};
        const capsule = wx.getMenuButtonBoundingClientRect?.();
        const navTop = info.statusBarHeight || 24;
        const navHeight = capsule?.height > 0 ? (capsule.top - navTop) * 2 + capsule.height : 44;
        this.setData({ navTop, navHeight, navRight: capsule?.left > 0 ? info.windowWidth - capsule.left + 12 : 100 });
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
        const userName = (session.userName || '').trim();
        const greeting = !userName || ['微信用户', '家人', '微信昵称'].includes(userName) ? '小厨师，开饭啦' : `${userName}，开饭啦`;
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
            const makeDishes = (items, mealLabel) => items.map((item, index) => dishView(item.recipe, mealLabel, `${mealLabel}-${index}-${item.recipeId}`));
            const breakfast = makeDishes(day?.breakfast || [], '早餐')[0] || null;
            const lunch = makeDishes(day?.lunch || [], '午餐');
            const dinner = makeDishes(day?.dinner || [], '晚餐');
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
                        const mealLabel = recipe.category === '早餐' ? '早餐' : todayDishes.filter((dish) => dish.mealLabel === '午餐').length <= todayDishes.filter((dish) => dish.mealLabel === '晚餐').length ? '午餐' : '晚餐';
                        todayDishes.push(dishView(recipe, mealLabel, `suggested-${recipe.id}`, true));
                        plannedIds.add(recipe.id);
                    }
                });
            }
            this.setData({
                familyName: currentFamily.family.name,
                userName,
                greeting,
                todayText: (0, date_1.formatToday)(),
                todayDishes,
                pollCandidates: (poll?.poll?.candidates || []).map((entry) => {
                    const recipe = (0, cloud_adapter_1.toRecipe)({ ...entry.recipeSnapshot, id: entry.recipeId, duration: 20 });
                    const currentRecipe = recipes.find((item) => item.id === entry.recipeId);
                    return dishView({ ...recipe, imagePath: currentRecipe?.imagePath || '' }, '晚餐', entry.recipeId);
                }),
                pollId: poll?.poll?.id || '',
                canCreatePoll: poll?.canCreate === true,
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
    onDishImageError(event) {
        const id = event.currentTarget.dataset.id;
        const withoutBrokenImage = (dish) => dish.id === id ? { ...dish, imagePath: '' } : dish;
        this.setData({ todayDishes: this.data.todayDishes.map(withoutBrokenImage), pollCandidates: this.data.pollCandidates.map(withoutBrokenImage) });
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
