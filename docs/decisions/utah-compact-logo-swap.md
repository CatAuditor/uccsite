# Logo Swap: Utah Outline Mark

Replaced the old red "UCC" square + wordmark, and the never-shipped torch-icon nav plan, with the org's new brand mark (Utah state outline containing a sunrise, mountains, and a bee, paired with a "UTAH CIVIC COMPACT" wordmark).

**Why:** The torch nav icon (see [nav-flatten-donate-button.md](nav-flatten-donate-button.md)) was scrapped before shipping in favor of this new mark, provided by the org as a single flattened image (icon + wordmark + tagline on a navy background — not a layered source file).

**Assets:**
- `assets/logo-icon.png` (320×320) — icon only, cropped tight around the Utah outline, navy background kept (no transparent/vector source was available to isolate the mark cleanly). Used for the nav icon and favicon.
- `UCC.png` (root, 550×590) — full lockup (icon + wordmark + tagline), replaces the old wide UCC.png in place so all existing `og:image`/`twitter:image` references and the hero/about `<img>` tags keep working. `width`/`height` attributes on those two `<img>` tags were updated from `1407×768` to `550×590` to match the new aspect ratio and avoid a layout shift.

**Where it landed:**
- Nav bar: pages with no existing brand mark (index, blog, stratos, team, theory, tip, privacy) got a new icon-only home link added at the top-right of `nav-inner`, reusing the CSS written for the torch plan (renamed `.nav-logo-torch`/`.nav-torch-img` → `.nav-logo-icon`/`.nav-icon-img`). Pages that already had a left-side text brand in the sticky header (projects, weber-county) had that mark's icon swapped in place instead of getting a second, redundant icon.
- Footer brand (`.logo-mark` span) swapped for an `<img class="logo-mark-img">` on every page; the "Utah Civic Compact" wordmark text stays as-is.
- Favicon links switched from `favicon.svg` to `assets/logo-icon.png` (PNG, since no vector version of the new mark exists).
- `build.js`: removed the `torch.svg` entry from `COPY_FROM_ROOT` (dead reference — the file was never added).

**Cropping approach:** No image-editing tool was available in this environment (no ImageMagick, no working Python/PIL — `sips --cropOffset` also proved unreliable/non-linear and wasn't used). Crops were produced with a small JXA (`osascript -l JavaScript`) script driving `NSImage`/`NSBitmapImageRep` to draw an arbitrary source rectangle into a new bitmap and export it as PNG.

**Not done:** `node` is not installed in this environment, so `node build.js` could not be run to regenerate `dist/` or visually verify the change. Run the build and check the nav icon, favicon, and hero/about image on all pages before deploying.
