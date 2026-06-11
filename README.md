# indflyt.dk — static site (GitHub Pages-ready)

Plain HTML/CSS, no build step. This is the public face of Indflyt **and** the I-A2 fake-door
price test. The site doubles as the privacy/support host required by App Store Connect —
the URLs match `AppConfig.swift` in the app repo (`/privacy/`, `/support/`).

## Pages

| Path | Purpose |
|---|---|
| `/` | Product landing page (App Store link activates at launch) |
| `/privacy/` | Privacy policy — **the ASC submission blocker; must be live before submit** |
| `/support/` | Support page (ASC support URL) |
| `/t/a/` | Fake door, 99 kr (test I-A2) — `noindex` |
| `/t/b/` | Fake door, 49 kr variant — `noindex` |
| `/t/guide/a/` | Hostbook (F1 host manual) fake door, $19 one-time (test F1-A2) — `noindex`, English |
| `/t/guide/b/` | Hostbook fake door, $29 variant — `noindex`, English |

## Publish (one evening)

1. Create a GitHub repo, push this folder, enable Pages (deploy from branch, root).
2. Point the domain: buy `indflyt.dk` (~100 kr/yr) and set the CNAME — or start on
   `<user>.github.io/<repo>` and update `AppConfig.swift` + `appstore/metadata.md` to match.
3. **Placeholders to replace before sharing any link:**
   - `REPLACE` in both fake-door CTAs → real Tally form id (create one form; it receives
     `?price=` as a hidden field so one form serves both variants).
   - `CF_TOKEN_HER` → Cloudflare Web Analytics token (cookieless; uncomment the snippet).
4. Share **either** `/t/a/` **or** `/t/b/` per post (alternate), never both in one group.

## Test I-A2 readout (playbook)

Measured event = click on the CTA ("pay-click"). **Green: ≥8 % visitors→pay-click** on either
price. Cloudflare Analytics gives visitors per path; Tally gives form opens + submissions per
price. Run ~10 days off one honest post in a large lejer-Facebook-group (read group rules,
post as a person). Record the result in the app repo's DECISIONS.md — it sets launch pricing.

## Test F1-A2 readout (Hostbook — the host-manual builder)

Context (verified 11 Jun 2026): Hostfully's **first guidebook is now free forever** (then
$9.99+/mo), Touch Stay ≈ $99+/yr with no free tier. The fake door therefore tests the
*narrowed* wedge: will a host pay **once** for a print-beautiful PDF book + hosted page,
against a free SaaS incumbent? Variants $19 (`/t/guide/a/`) vs $29 (`/t/guide/b/`).
Same placeholders as I-A2 (`REPLACE` Tally id — one form, hidden `price` field; `CF_TOKEN_HER`).
Traffic: one honest post in an Airbnb-host community (r/airbnb_hosts-class — read rules,
post as a person), ~10 days. **Green: ≥8 % visitor→pay-click on either price.** Note Etsy
sells *static* welcome-book templates at $10–30 — the door's price points bracket that.
"Hostbook" is a working name; check availability before any launch use.

## Design

"Dokument"-aesthetic matching the app's PDF artifact: paper `#F5F1E8`, ink blue `#1D3557`,
stamp red `#C2452D`, Fraunces + IBM Plex Mono/Sans, hairline rules, SHA-256 strings as
ornament. Edit `styles.css` tokens to retheme.
