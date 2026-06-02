# Nav Flatten + Donate Button

Removed all dropdown menus from navigation. Replaced "About" dropdown (Team & Bios, Theory of Change) and "Our Work" dropdown (Issues, News & Blog) with flat top-level links.

**Why:** Dropdowns added friction and hid important pages. All destination pages are valuable enough to be first-class nav items. Flat nav is faster on mobile and removes the JS dependency for hover/click states.

**Renamed links:**
- "Team & Bios" → "About Us" (team.html)
- "News & Blog" → "News & Media" (blog.html)
- "Issues" link removed from nav (still accessible via homepage scroll)

**Donate button** added as a prominent red CTA in the nav linking to `/#donate`. Styled identically to "Get Involved" (`.nav-donate` shares rules with `.nav-cta`).

**Torch logo** added to top-right of nav bar (`/torch.svg`, 44px desktop / 36px mobile). Doubles as home link. Also replaced `favicon.svg` with `torch.svg` sitewide.

**Alternative considered:** Keep dropdowns, just reorganize items. Rejected — the nav already had too few items to justify two levels.
