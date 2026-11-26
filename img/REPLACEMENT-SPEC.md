# Real-photo replacement spec (temporary working notes — remove before merge)

Rule: real photos only, never AI-generated images, anywhere on this site.

Upload the owner's real photos into this `img/` folder as JPG with the same basenames
(`01-hero.jpg`, `02-websites.jpg`, …). They will then be cropped to the aspect ratios
below and exported as the existing WebP file set, so the layout does not shift.

| Basename | Aspect | Current files (WebP) | Minimum source size for a clean crop |
|---|---|---|---|
| 01-hero | 16:9 | 1600×900, 1200×675, 800×450 | 1600×900 |
| 02-websites | 16:9 | 1600×900, 1200×675, 800×450 | 1600×900 |
| 04-cafe | 16:9 | 1600×900, 800×450, 480×270 | 1600×900 |
| 05-salon | 16:9 | 1600×900, 800×450, 480×270 | 1600×900 |
| 06-foodtruck | 16:9 | 1600×900, 800×450, 480×270 | 1600×900 |
| 07-team | 16:9 | 1600×900, 1200×675, 800×450 | 1600×900 |
| 08-phone | 752:941 (≈4:5, portrait) | 752×941, 480×601 | 752×941 |
| store-beauty | 3:2 | 1728×1152, 800×533, 480×320 | 1728×1152 |
| store-crafts | 3:2 | 1728×1152, 800×533, 480×320 | 1728×1152 |
| store-food | 3:2 | 1728×1152, 800×533, 480×320 | 1728×1152 |

Smaller sources will not be upscaled; the largest variant would be dropped instead.

## Where each image is used
- 01-hero: EN/JA/ZH homepage hero; /for/restaurants, /for/salons, /for/food-trucks (og:image);
  /resources/* and /privacy/ (og:image only); old-site/
- 02-websites, 07-team, 08-phone: EN/JA/ZH homepages; old-site/
- 04-cafe, 05-salon, 06-foodtruck: EN/JA/ZH homepage tiles; matching /for/ page hero; old-site/
- store-beauty, store-crafts, store-food: EN/JA/ZH homepage tiles

Alt text on every page that uses an image will be updated to describe the real photo.
