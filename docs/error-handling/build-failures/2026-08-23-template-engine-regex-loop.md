# build.js: "RangeError: Invalid string length" in render()

**Date:** 2026-08-23
**Error:** `RangeError: Invalid string length at render (build.js:105)` — process hung growing `out` until V8's string limit.
**File:** `build.js` `render()`

## Cause
The new single-pass tokenizer used one module-level global regex (`TAG_RE`, `/g`). `render()` recurses for sections/partials, and the inner call reset and advanced the shared `lastIndex`, corrupting the outer loop's position so it re-matched the same tag forever.

## Fix
Construct a fresh `RegExp` per `render()` call (`new RegExp(TAG_RE_SRC.source, 'g')`).

## Would catch it earlier
A unit test rendering a template with a loop inside a partial. None exist yet; `node build.js` on the real templates is the current test.
