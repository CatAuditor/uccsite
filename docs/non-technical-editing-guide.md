# Editing the UCC Website — Guide for Non-Technical Team Members

This is a plain-language guide to what the Utah Civic Compact website can already do, how to make small content changes yourself, and how to get Claude's help for everything else.

---

## 1. What the Site Already Does

You don't need to build any of this — it's live and working. Good to know it exists before asking for something that's already there.

| Feature | What it does | Where |
|---|---|---|
| **Email signup** | Visitors join the mailing list; they get an automatic welcome email (via Resend) | Homepage "Join" section |
| **Donations** | Visitors donate via credit card (Stripe Checkout); a live progress bar and recent-donor list update automatically | Homepage "Donate" section |
| **Donor billing portal** | Recurring donors enter their email and receive a 15-minute sign-in link to manage/cancel their subscription | Linked from donation receipt emails |
| **Confidential tipline** | A form for anonymous or named tips, stored privately (Airtable) — not public | `/tip` |
| **News & Press** | List of press articles and embedded video coverage | `/blog.html` ("News & Media") |
| **Official Statements** | Formal org statements, e.g. the NDAA/SAVE Act statement | `/statements.html` |
| **Team & Bios** | Staff/leadership names, titles, and bios | `/team.html` |
| **Active Projects/Fights** | Cards summarizing ongoing campaigns (e.g. Stratos, Weber County) | Homepage + `/projects.html` |
| **Contact email** | `info@utahciviccompact.org` | Footer, site settings |

---

## 2. Making Small Changes Yourself: the Admin Panel

For simple content updates, you can log in and edit the site directly — no code involved.

**URL:** https://utahciviccompact.org/admin/
**Login:** with a GitHub account that has access to the site's repository.

**You can edit there:**
- Site Settings (contact email, Instagram link, footer tagline, copyright line)
- Homepage text (headline, mission quote, "About," "Join," "Donate" sections, donation popup, featured press)
- Team members (add/remove/edit name, title, bio)
- Statements (the newest one is automatically featured on the homepage)
- Policy Positions
- News & Press (add articles and YouTube videos)
- Active Projects (project cards plus their press and video coverage)

Text fields support **bold**, *italic*, and links written as `[link text](https://example.com)`. A blank line starts a new paragraph.

Changes you save in the admin panel go live automatically within a few minutes — there's no separate "publish" step, so double-check text before saving.

**Not yet editable in the admin panel** (needs Claude or a developer):
- Navigation menu, page layout, colors, fonts
- The long-form investigation pages (ALPR, Stratos, Weber County, Privacy Report, Theory of Change)
- Donation goal amount, payment/tipline configuration
- Anything involving new pages or site structure

---

## 3. Getting Claude's Help (No Code Knowledge Needed)

You can just describe what you want in plain English — Claude can make the change in the underlying files and commit it for you. You don't need to know what a "template" or "JSON file" is.

**Good examples of requests you can make:**
- "Add a new team member: Jane Doe, Communications Director. Bio: ..."
- "Add this news article to the press page: [outlet], [headline], [link], [date]"
- "Update the mission quote on the homepage to say: ..."
- "Add this KSL video to News & Media: [YouTube link]"
- "Fix the typo in the About section — it says 'thier' and should say 'their'"

**What to include when asking:**
- The exact text you want (Claude won't guess wording for you)
- Where it should go (which page/section)
- Any link, date, or image that goes with it

**What Claude can't do for you:** log into the Stripe or Resend dashboards on your behalf, or make judgment calls about organizational messaging — you make the call, Claude executes it.

---

## 4. Big Changes — Please Don't Push These Yourself

Small content edits (the kind described above) are safe to make directly. But **please don't personally push larger changes to the live site** — things like:
- New pages or navigation changes
- Redesigns, layout, or styling changes
- Changes to payments, the tipline, or email sending
- Anything touching code files directly (outside the admin panel)

**Why:** the `main` branch of this site deploys to the live site automatically and instantly. There's no "preview" or approval step before the public sees it, and no simple undo button — reverting a bad change means another deploy. For anything beyond a straightforward content tweak, ask Claude to make the change and flag it for review rather than approving/pushing it yourself.
