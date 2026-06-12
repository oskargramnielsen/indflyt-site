/**
 * indflyt-door — fake-door measurement worker (test I-A2).
 *
 * Replaces Tally + analytics for the price test:
 *   GET  /hit?v=a          page-view beacon from the fake-door pages (204)
 *   GET  /go?v=a&price=99  the CTA target = the measured "pay-click"; serves the
 *                          email-capture page
 *   POST /signup           stores the email, serves the thank-you page
 *   GET  /stats?key=SECRET aggregated JSON readout (visits/clicks/signups per variant)
 *
 * Events are individual KV keys (no read-modify-write races at this volume):
 *   e:<type>:<variant>:<ts>:<rand> -> JSON
 */

const PAGE_CSS = `
  :root { --paper:#f5f1e8; --ink:#1b2a41; --blue:#1d3557; --stamp:#c2452d; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--paper); color:var(--ink); font-family:Georgia,serif;
         min-height:100vh; display:grid; place-items:center; padding:24px;
         background-image:radial-gradient(rgba(27,42,65,.035) 1px,transparent 1px);
         background-size:28px 28px; }
  .card { max-width:430px; width:100%; }
  .mono { font-family:'Courier New',monospace; font-size:11px; letter-spacing:.14em;
          text-transform:uppercase; color:rgba(27,42,65,.55); }
  h1 { font-size:30px; line-height:1.1; margin:14px 0 12px; }
  h1 em { font-style:italic; color:var(--stamp); }
  p { font-size:16px; line-height:1.55; margin-bottom:18px; }
  input[type=email] { width:100%; padding:14px; font-size:17px; border:1.5px solid var(--ink);
          border-radius:4px; background:#fff; font-family:inherit; margin-bottom:10px; }
  button { width:100%; padding:15px; font-size:18px; font-family:inherit; font-weight:600;
           background:var(--blue); color:var(--paper); border:none; border-radius:4px;
           box-shadow:4px 4px 0 var(--stamp); cursor:pointer; }
  button:active { transform:translate(3px,3px); box-shadow:1px 1px 0 var(--stamp); }
  .fine { font-size:12.5px; color:rgba(27,42,65,.55); margin-top:14px; line-height:1.5; }
`;

function page(title, body) {
  return new Response(
    `<!DOCTYPE html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>${PAGE_CSS}</style></head><body><div class="card">${body}</div></body></html>`,
    { headers: { "content-type": "text/html;charset=utf-8" } }
  );
}

async function record(env, type, variant, extra = {}) {
  const key = `e:${type}:${variant}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await env.DOOR.put(key, JSON.stringify(extra));
}

function cleanVariant(v) {
  return /^[a-z0-9-]{1,12}$/.test(v || "") ? v : "x";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const v = cleanVariant(url.searchParams.get("v"));

    if (url.pathname === "/hit") {
      await record(env, "visit", v);
      return new Response(null, {
        status: 204,
        headers: { "access-control-allow-origin": "*" },
      });
    }

    if (url.pathname === "/go") {
      const price = (url.searchParams.get("price") || "").replace(/[^0-9]/g, "") || "99";
      await record(env, "click", v, { price });
      return page(
        "Indflyt — skriv dig op",
        `<div class="mono">INDFLYT · LANCERES 1. AUGUST 2026</div>
         <h1>Du er der <em>næsten</em></h1>
         <p>Indflyt udkommer på App Store <strong>1. august</strong> — lige til studiestart.
            Skriv din mail, så får du besked på dagen, og launch-prisen
            (<strong>${price} kr</strong>) er låst til dig.</p>
         <form method="POST" action="/signup">
           <input type="hidden" name="v" value="${v}">
           <input type="hidden" name="price" value="${price}">
           <input type="email" name="email" placeholder="din@mail.dk" required autocomplete="email">
           <button type="submit">Skriv mig op</button>
         </form>
         <p class="fine">Vi bruger kun din mail til én besked om lanceringen. Ingen nyhedsbreve,
            ingen videregivelse — slettes efter lancering.</p>`
      );
    }

    if (url.pathname === "/signup" && request.method === "POST") {
      const form = await request.formData();
      const email = String(form.get("email") || "").slice(0, 200);
      const price = String(form.get("price") || "").replace(/[^0-9]/g, "");
      const variant = cleanVariant(String(form.get("v")));
      if (email.includes("@")) {
        await record(env, "signup", variant, { email, price });
      }
      return page(
        "Tak!",
        `<div class="mono">INDFLYT · DU ER SKREVET OP</div>
         <h1>Tak — du hører fra os <em>1. august</em></h1>
         <p>Ét godt råd indtil da: dokumentér alt den dag, du overtager — billeder af hvert rum,
            målerstande, og send din fejl- og mangelliste inden 14 dage.</p>
         <p class="fine">Du kan lukke siden nu.</p>`
      );
    }

    if (url.pathname === "/stats") {
      if (url.searchParams.get("key") !== env.STATS_KEY) {
        return new Response("forbidden", { status: 403 });
      }
      const stats = {};
      const emails = [];
      let cursor;
      do {
        const list = await env.DOOR.list({ prefix: "e:", cursor, limit: 1000 });
        for (const k of list.keys) {
          const [, type, variant] = k.name.split(":");
          stats[variant] ??= { visit: 0, click: 0, signup: 0 };
          stats[variant][type] = (stats[variant][type] || 0) + 1;
          if (type === "signup") {
            const val = await env.DOOR.get(k.name, "json");
            if (val?.email) emails.push({ email: val.email, price: val.price, variant });
          }
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);

      for (const s of Object.values(stats)) {
        s.clickRate = s.visit ? +(100 * s.click / s.visit).toFixed(1) + "%" : "n/a";
      }
      return Response.json({
        rule: "GREEN if click/visit >= 8% on either variant (playbook I-A2)",
        variants: stats,
        emails,
      });
    }

    return Response.redirect("https://oskargramnielsen.github.io/indflyt-site/", 302);
  },
};
