# Nav: About Us Dropdown, Stratos Folded into Projects

Replaced the flat top-level "Theory of Change" and "Stratos" nav links with an "About Us" dropdown (Team & Bios, Theory of Change, Policies) plus a flatter top level: Mission, About Us, News & Media, Projects, Submit a Tip, Donate, Get Involved.

**Why:** Nav had grown to 9 items. Theory of Change and Policy Positions are "about the org" context rather than destinations someone navigates to directly, so they're grouped under About Us. Stratos no longer needs standalone top-level placement — it's still one click away via its project card on `/projects.html` (which links to `/stratos.html`).

**Supersedes:**
- [nav-flatten-donate-button.md](nav-flatten-donate-button.md) — previously removed all dropdowns in favor of flat nav. Reintroducing one dropdown here because the flat list had grown past a comfortable size again.
- [stratos-page-nav-placement.md](stratos-page-nav-placement.md) — previously kept Stratos as a top-level link for campaign urgency. That urgency-driven placement is no longer needed; Stratos remains reachable via Projects.

**Implementation:** Reused existing (previously unused) `.nav-dropdown` / `.nav-dropdown-toggle` / `.nav-dropdown-menu` CSS and JS in `css/styles.css` and `js/main.js` — the dropdown component already existed from an earlier iteration but had no markup using it.

**Policies page:** No new page was built. The nav links to the existing `/issues.html` ("Policy Positions" content, `content/issues.json`) added in a prior commit but never wired into nav — labeled "Policies" in the dropdown for brevity.
