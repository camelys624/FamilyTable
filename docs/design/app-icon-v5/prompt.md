# 小程序图标 · 三张靠背椅

生成方式：内置 image_gen 生图模型，编辑第四版 PNG。

排列要求：圆桌四个正方位中，上、左、右各一张带靠背的椅子，下方留空；三张椅子均朝向桌子。保留三道菜、浅绿配色和手绘插画风格。

第一轮排列调整提示词：

```text
Edit the provided app-icon-v4.png. It is the EDIT TARGET: a square raster app icon showing a green dining table, three dishes, and three backless stools.
Primary change: Replace the three backless stools with exactly THREE matching chairs WITH BACKRESTS, and correct their spatial arrangement.
Seat layout is a strict four-compass-position layout around the round table, not a triangle of diagonal positions:
- one chair centered at the TOP / 12 o'clock / north of the table;
- one chair centered at the LEFT / 9 o'clock / west of the table;
- one chair centered at the RIGHT / 3 o'clock / east of the table;
- the BOTTOM / 6 o'clock / south position is EMPTY. No chair, stool, seat or backrest at the bottom.
The three chairs all face inward toward the table. Each has a simple rounded seat, a clearly visible upright backrest, and minimal legs. Use a sufficiently elevated three-quarter view so the top chair's backrest is behind its seat, the left chair's backrest is on the outer left side, and the right chair's backrest is on the outer right side. Their center positions must line up with the vertical or horizontal center axes of the tabletop. Do NOT put chairs in upper-left, upper-right or bottom-center diagonal positions. Make all THREE chairs easy to count, with enough visible separation from the table and no overlapping food.
Keep unchanged: the three dishes (greens, tomato-and-egg, fish), the calm pale sage-green square background, sage table, deep forest-green rounded ink outlines, warm cream, and small yellow/red food accents. Preserve the warm hand-painted gouache and gently organic linework of this specific image, in harmony with a minimal family recipe app.
Composition: one centered and balanced icon, allow a small adjustment of the tabletop angle and scale only to make the compass layout readable. Keep a generous clear margin around the entire ensemble for circular avatar cropping. Front/bottom space should be visibly open.
Avoid: fourth chair, backless stools, people, text, decorations, utensils, extra dishes, a triangular stool arrangement, mechanically uniform vector outlines, glossy 3D, dramatic shadows, patterns, borders, mockups or multiple variants.
Output: one finished square raster app icon. The essential change is THREE BACKREST CHAIRS at TOP, LEFT, RIGHT, with BOTTOM EMPTY.
```

第二轮留白调整提示词：

```text
Edit this image with ONE change only: increase the empty background padding around the whole table-and-chairs ensemble.
Preserve the illustration itself, its hand-painted style, all three dishes, and the EXACT THREE BACKREST CHAIRS in the existing TOP, LEFT, RIGHT cardinal positions, with BOTTOM EMPTY. Do not move chairs relative to the table and do not add any chair.
Scale the entire combined table, dishes and three chairs down uniformly so its full widest outline occupies about 72% of the square image width, giving roughly 14% completely clear pale sage background margin on both the left and right. Center the whole ensemble in the square, with at least 12% clear margin above and below. Keep every chair, leg, backrest and dish fully inside this safe padded area.
Fill all newly exposed space with the same plain pale sage-green background #EAF2EA. The illustration should remain big enough to read as an app icon, but no furniture should approach the canvas edges.
Keep everything else unchanged: the green round table, greens dish, tomato-and-egg dish, fish dish, exactly three inward-facing matching chairs with backrests at top/left/right, empty bottom, the calm color palette, organic gouache textures and deep green ink linework. No new objects, text, border, inset frame or mockup. One square app icon.
```
