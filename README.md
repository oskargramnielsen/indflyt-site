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

## Design

"Dokument"-aesthetic matching the app's PDF artifact: paper `#F5F1E8`, ink blue `#1D3557`,
stamp red `#C2452D`, Fraunces + IBM Plex Mono/Sans, hairline rules, SHA-256 strings as
ornament. Edit `styles.css` tokens to retheme.
