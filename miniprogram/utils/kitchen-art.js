"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kitchenArt = kitchenArt;
const CELLS = {
    basket: [0, 0], menu: [1, 0], book: [2, 0], shopping: [3, 0],
    table: [0, 1], chilli: [1, 1], eggsDish: [2, 1], fish: [3, 1],
    greensDish: [0, 2], soup: [1, 2], oil: [2, 2], seasoning: [3, 2],
};
/** Display-only artwork. Unknown foods keep a neutral notebook illustration. */
function kitchenArt(name = '', kind = 'book') {
    const normalized = name.trim();
    const raw = { '番茄': [0, 1], '西红柿': [0, 1], '鸡蛋': [1, 1], '青菜': [2, 1], '菜心': [2, 1], '小白菜': [2, 1] };
    if (raw[normalized]) {
        const [column, row] = raw[normalized];
        return { src: '/assets/fridge/illustrations-v2.webp', style: `width:300%;height:200%;left:-${column * 100}%;top:-${row * 100}%;` };
    }
    let selected = kind;
    if (/番茄.*蛋|西红柿.*蛋/.test(normalized))
        selected = 'eggsDish';
    else if (/清蒸.*鱼|蒸.*鲈鱼/.test(normalized))
        selected = 'fish';
    else if (/蒜蓉.*菜|清炒.*菜/.test(normalized))
        selected = 'greensDish';
    else if (/汤$|粥$/.test(normalized))
        selected = 'soup';
    else if (/^(食用油|植物油|花生油)$/.test(normalized))
        selected = 'oil';
    else if (/^(盐|食盐|葱|小葱|香葱)$/.test(normalized))
        selected = 'seasoning';
    const [column, row] = CELLS[selected] || CELLS.book;
    return { src: '/assets/kitchen/illustrations-v2.webp', style: `width:400%;height:300%;left:-${column * 100}%;top:-${row * 100}%;` };
}
