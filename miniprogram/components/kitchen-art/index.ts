import { kitchenArt } from '../../utils/kitchen-art'

Component({
  externalClasses: ['art-size'],
  properties: { kind: { type: String, value: 'book' }, name: { type: String, value: '' }, size: { type: Number, value: 160 } },
  data: { ...kitchenArt() },
  observers: {
    'name, kind'(name: string, kind: string) { this.setData(kitchenArt(name, kind)) },
  },
})
