"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const kitchen_art_1 = require("../../utils/kitchen-art");
Component({
    externalClasses: ['art-size'],
    properties: { kind: { type: String, value: 'book' }, name: { type: String, value: '' }, size: { type: Number, value: 160 } },
    data: { ...(0, kitchen_art_1.kitchenArt)() },
    observers: {
        'name, kind'(name, kind) { this.setData((0, kitchen_art_1.kitchenArt)(name, kind)); },
    },
});
