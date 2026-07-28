# Nav Flatten + Donate Button

Removed all dropdown menus from navigation. Replaced "About" dropdown (Team & Bios, Theory of Change) and "Our Work" dropdown (Issues, News & Blog) with flat top-level links.

**Why:** Dropdowns added friction and hid important pages. All destination pages are valuable enough to be first-class nav items. Flat nav is faster on mobile and removes the JS dependency for hover/click states.

**Renamed links:**
- "Team & Bios" → "About Us" (team.html)
- "News & Blog" → "News & Media" (blog.html)
- "Issues" link removed from nav (still accessible via homepage scroll)

**Donate button** added as a prominent red CTA in the nav linking to `/#donate`. Styled identically to "Get Involved" (`.nav-donate` shares rules with `.nav-cta`).

**Torch logo** — a torch icon (`/torch.svg`) was planned for the top-right of the nav bar, doubling as a home link, with `favicon.svg` also replaced by `torch.svg` sitewide. The CSS (`.nav-logo-torch`/`.nav-torch-img`) was written but the torch artwork and markup were never shipped. Superseded — see [utah-compact-logo-swap.md](utah-compact-logo-swap.md).

**Alternative considered:** Keep dropdowns, just reorganize items. Rejected — the nav already had too few items to justify two levels.
