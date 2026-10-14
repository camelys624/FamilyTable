"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatToday = formatToday;
exports.getWeekDates = getWeekDates;
exports.getCurrentWeekKey = getCurrentWeekKey;
exports.getFamilyToday = getFamilyToday;
exports.getWeekNumber = getWeekNumber;
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function pad(value) {
    return String(value).padStart(2, '0');
}
function toDateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function getMonday(anchor = new Date()) {
    const date = new Date(anchor);
    date.setHours(12, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date;
}
function formatToday() {
    const date = new Date();
    return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;
}
function getWeekDates() {
    const monday = getMonday();
    return Array.from({ length: 7 }).map((_, index) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + index);
        return {
            key: toDateKey(date),
            weekday: ['一', '二', '三', '四', '五', '六', '日'][index],
            dateLabel: `${date.getMonth() + 1}/${date.getDate()}`,
        };
    });
}
function getCurrentWeekKey() {
    const date = new Date(`${getFamilyToday()}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() || 7) + 1);
    return date.toISOString().slice(0, 10);
}
function getFamilyToday() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function getWeekNumber() {
    const date = getMonday();
    const target = new Date(date.valueOf());
    target.setDate(target.getDate() + 3);
    const firstThursday = new Date(target.getFullYear(), 0, 4, 12);
    const firstMonday = getMonday(firstThursday);
    return 1 + Math.round((target.getTime() - firstMonday.getTime()) / 604800000);
}
