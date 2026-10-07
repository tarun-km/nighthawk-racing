# Hawk Racing livery templates

Each car's paint job is one square image, 2048 x 2048 px. The game wraps it onto the car body using six views: top, front, rear, right side, left side and underside.

| Car | Template to design on | Guide overlay | Default livery (what the game loads) |
| --- | --- | --- | --- |
| Classic Cruiser | `classic-template.png` | `classic-guide.png` | `public/liveries/classic.png` |
| Ultra Buggy | `ultra-template.png` | `ultra-guide.png` | `public/liveries/ultra.png` |

`*-preview.jpg` shows the default livery with the guide on top.

## Editing in Canva

1. Create a custom design at 2048 x 2048 px.
2. Upload `public/liveries/<car>.png` as the bottom layer (or start from the template).
3. Upload `<car>-guide.png` as the top layer. It is transparent: lime lines are the car outline, white lines are panel edges.
4. Design between them. Fill each whole rectangle with your background colour, because colours bleed slightly at curved edges. Keep logos and text inside the lime outline.
5. Hide or delete the guide layer, then download as PNG.
6. Save the file over `public/liveries/classic.png` or `public/liveries/ultra.png`, then reload the game.

Orientation: in the top view the front of the car points right. The right side view also faces right, and the left side view faces left. Text drawn upright in each view reads correctly on the car.

## Regenerating templates

If the car shapes change in `src/vehicles/shells.js`, rebuild the templates:

```bash
node scripts/livery-uv.mjs livery-uv.json
python scripts/livery_templates.py livery-uv.json <folder with BebasNeue, ChakraPetch-Bold and Unbounded TTFs>
```

The second command also rewrites the default liveries in `public/liveries/`, so back up your own designs first.
