/* Indflyt webapp — guided move-in documentation, fully client-side.
   State in localStorage, photos in IndexedDB, SHA-256 via WebCrypto,
   report = print-to-PDF, manifest hash anchored server-side (bevis-anker). */

"use strict";

const WORKER = "https://indflyt-door.oskargram1996.workers.dev";
const STATE_KEY = "indflyt-app";

// ---------- seed content (mirrors the iOS spec exactly) ----------
const BASE_ITEMS = ["Gulve","Vægge","Lofter","Vinduer og karme","Døre og karme","Fodlister",
  "El-kontakter og lampeudtag","Radiatorer/termostater","Nøgler og låse"];
const KITCHEN_EXTRAS = ["Bordplade","Skabe og skuffer","Hårde hvidevarer (stand + foto af model/serienr.)","Vandhane og afløb","Emhætte"];
const BATH_EXTRAS = ["Fliser og fuger","Sanitet (toilet, håndvask)","Vandhane og bruser","Afløb","Ventilation"];
const DEFAULT_ROOMS = [
  { name:"Entré", sym:"🚪", extras:[] }, { name:"Stue", sym:"🛋️", extras:[] },
  { name:"Værelse 1", sym:"🛏️", extras:[] }, { name:"Køkken", sym:"🍳", extras:KITCHEN_EXTRAS },
  { name:"Badeværelse", sym:"🚿", extras:BATH_EXTRAS }, { name:"Andet", sym:"📦", extras:[] },
];
const CONDITIONS = ["notChecked","ok","defect","notApplicable"];
const COND_LABEL = { notChecked:"Ikke gennemgået", ok:"OK", defect:"Fejl/mangel", notApplicable:"Ikke relevant" };
const COND_SYM = { notChecked:"○", ok:"✅", defect:"⚠️", notApplicable:"➖" };
const SEVS = ["Kosmetisk","Funktionel","Alvorlig"];
const METER_TYPES = ["El","Vand","Varme"];

// ---------- tiny helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const esc = s => { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; };
const MONTHS = ["januar","februar","marts","april","maj","juni","juli","august","september","oktober","november","december"];
const fmtDate = iso => { if (!iso) return "—"; const [y,m,d] = iso.slice(0,10).split("-"); return `${+d}. ${MONTHS[+m-1]} ${y}`; };
const fmtTs = iso => { const t = new Date(iso); return `${fmtDate(iso)} kl. ${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`; };
const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
async function sha256Hex(buf) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2,"0")).join("");
}

// ---------- IndexedDB for photos ----------
let dbp = null;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open("indflyt", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath:"id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction("photos", mode);
    const out = fn(tx.objectStore("photos"));
    tx.oncomplete = () => res(out.result ?? out);
    tx.onerror = () => rej(tx.error);
  });
}
const putPhoto = rec => idb("readwrite", s => s.put(rec));
const getPhoto = id => idb("readonly", s => s.get(id));
const delPhoto = id => idb("readwrite", s => s.delete(id));
const clearPhotos = () => idb("readwrite", s => s.clear());

const urlCache = new Map();
async function photoURL(id) {
  if (!urlCache.has(id)) {
    const rec = await getPhoto(id);
    if (!rec) return null;
    urlCache.set(id, URL.createObjectURL(rec.blob));
  }
  return urlCache.get(id);
}

// Downscale to max 2000 px, JPEG 0.85, hash the stored bytes.
async function processFile(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width*scale), h = Math.round(bmp.height*scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
  const hash = await sha256Hex(await blob.arrayBuffer());
  const rec = { id: uid(), blob, sha256: hash, capturedAt: new Date().toISOString() };
  await putPhoto(rec);
  return rec.id;
}

// ---------- state ----------
let S = null;
function load() { try { S = JSON.parse(localStorage.getItem(STATE_KEY) || "null"); } catch(e) { S = null; } }
function save() { localStorage.setItem(STATE_KEY, JSON.stringify(S)); }
function newInspection(f) {
  S = {
    createdAt: new Date().toISOString(),
    addressLine: f.addressLine, postalCode: f.postalCode, city: f.city,
    takeoverDate: f.takeoverDate, tenantName: f.tenantName, landlordName: f.landlordName,
    rooms: DEFAULT_ROOMS.map(r => ({
      id: uid(), name: r.name, sym: r.sym, note: "",
      items: BASE_ITEMS.concat(r.extras).map(t => ({ id: uid(), title: t, condition: "notChecked", defects: [] })),
    })),
    meters: METER_TYPES.map(t => ({ id: uid(), type: t, value: "", readAt: null, photoId: null })),
    anchor: null,
  };
  save();
}
const allDefects = () => S.rooms.flatMap(r => r.items.flatMap(i => i.defects.map(d => ({ ...d, room: r.name, item: i.title }))));
const allPhotoIds = () => allDefects().flatMap(d => d.photos).concat(S.meters.map(m => m.photoId).filter(Boolean));

// ---------- routing / render ----------
let route = { screen: "start" };
const view = document.getElementById("view");
function go(r) { route = r; render(); window.scrollTo(0, 0); }

function render() {
  if (!S && route.screen !== "setup") route = { screen: "start" };
  ({ start: renderStart, setup: renderSetup, overview: renderOverview,
     room: renderRoom, meters: renderMeters, report: renderReport })[route.screen]();
}

// ---------- screens ----------
function renderStart() {
  if (S) return go({ screen: "overview" });
  view.innerHTML = `
    <section class="hero reveal">
      <h1>Dokumentér din indflytning<br><em>på 30 minutter</em></h1>
      <p class="sub">Dansk tjekliste rum for rum, fotos med SHA-256-fingeraftryk, målerstande —
      samlet i én rapport med fejl- og mangelliste, klar til din udlejer inden 14-dages fristen.
      Alt bliver i din browser.</p>
      <span class="stamp">Gratis · Tidsforankret · Ingen konto</span>
      <button class="btn" id="start">Start din gennemgang</button>
    </section>`;
  document.getElementById("start").onclick = () => go({ screen: "setup" });
}

function renderSetup() {
  view.innerHTML = `
    <div class="crumb">NY GENNEMGANG</div>
    <div class="card">
      <label class="f">Lejemålets adresse</label><input id="adr" placeholder="Gadenavn 12, 2. th">
      <div class="row2">
        <div><label class="f">Postnr. og by</label><input id="post" placeholder="2200 København N"></div>
        <div><label class="f">Overtagelsesdato</label><input id="dato" type="date"></div>
      </div>
      <div class="row2">
        <div><label class="f">Lejer (dig)</label><input id="lejer"></div>
        <div><label class="f">Udlejer (valgfrit)</label><input id="udlejer"></div>
      </div>
      <p class="small" style="margin-top:10px">Overtagelsesdatoen starter 14-dages fristen for din fejl- og mangelliste.</p>
      <button class="btn" id="create">Opret gennemgang</button>
    </div>`;
  document.getElementById("create").onclick = () => {
    const adr = document.getElementById("adr").value.trim();
    if (!adr) { document.getElementById("adr").focus(); return; }
    const [postalCode, ...cityParts] = document.getElementById("post").value.trim().split(" ");
    newInspection({
      addressLine: adr, postalCode: postalCode || "", city: cityParts.join(" "),
      takeoverDate: document.getElementById("dato").value || new Date().toISOString().slice(0,10),
      tenantName: document.getElementById("lejer").value.trim(),
      landlordName: document.getElementById("udlejer").value.trim(),
    });
    navigator.storage?.persist?.();
    go({ screen: "overview" });
  };
}

function renderOverview() {
  const deadline = addDays(S.takeoverDate, 14);
  const daysLeft = Math.round((new Date(deadline) - new Date(new Date().toISOString().slice(0,10))) / 86400000);
  const defects = allDefects().length;
  view.innerHTML = `
    <div class="crumb">${esc(S.addressLine)}</div>
    <div class="deadline"><div class="small">Frist for fejl- og mangelliste</div>
      <strong>${fmtDate(deadline)}</strong>
      <span class="small">${daysLeft >= 0 ? `· ${daysLeft} dage tilbage` : "· fristen er udløbet — dokumentationen er stadig værdifuld"}</span>
      <div><a id="ics" style="font-size:13px;color:var(--blue);cursor:pointer;text-decoration:underline">Tilføj påmindelse til din kalender (.ics)</a></div>
    </div>
    <div class="roomgrid">${S.rooms.map(r => {
      const done = r.items.filter(i => i.condition !== "notChecked").length;
      const dc = r.items.reduce((n,i) => n + i.defects.length, 0);
      return `<div class="roomcard" data-r="${r.id}"><span class="ring">${done}/${r.items.length}</span>
        <div>${r.sym}</div><h4>${esc(r.name)}</h4>
        <div class="sub">${dc ? `⚠️ ${dc} fejl` : `${r.items.length} punkter`}</div></div>`;
    }).join("")}</div>
    <div class="card" id="metercard" style="cursor:pointer"><h3>Målerstande</h3>
      <p class="small">${S.meters.filter(m => m.value).length} af ${S.meters.length} aflæst — husk foto af hver måler</p></div>
    <button class="btn" id="report">Se rapport (${defects} fejl · ${allPhotoIds().length} fotos)</button>`;
  view.querySelectorAll(".roomcard").forEach(el => el.onclick = () => go({ screen: "room", roomId: el.dataset.r }));
  document.getElementById("metercard").onclick = () => go({ screen: "meters" });
  document.getElementById("report").onclick = () => go({ screen: "report" });
  document.getElementById("ics").onclick = downloadICS;
}

function renderRoom() {
  const room = S.rooms.find(r => r.id === route.roomId);
  if (!room) return go({ screen: "overview" });
  view.innerHTML = `
    <div class="crumb"><a id="back">← Oversigt</a> · ${esc(room.name)}</div>
    <p class="small">Tryk på cirklen: ○ ikke gennemgået → ✅ OK → ⚠️ fejl → ➖ ikke relevant</p>
    <div id="items"></div>
    <div class="card"><label class="f">Note til rummet (valgfri)</label>
      <textarea id="note" rows="2">${esc(room.note)}</textarea></div>`;
  document.getElementById("back").onclick = () => go({ screen: "overview" });
  document.getElementById("note").oninput = e => { room.note = e.target.value; save(); };
  const wrap = document.getElementById("items");
  room.items.forEach(item => wrap.appendChild(itemRow(room, item)));
}

function itemRow(room, item) {
  const el = document.createElement("div");
  el.className = "item";
  const draw = () => {
    el.innerHTML = `<div class="head"><span>${esc(item.title)}</span>
      <button class="cond" title="${COND_LABEL[item.condition]}">${COND_SYM[item.condition]}</button></div>
      <div class="dlist"></div>`;
    el.querySelector(".cond").onclick = () => {
      item.condition = CONDITIONS[(CONDITIONS.indexOf(item.condition)+1) % 4];
      if (item.condition === "defect" && !item.defects.length) item.defects.push({ id: uid(), text:"", severity:"Funktionel", photos:[], createdAt:new Date().toISOString() });
      save(); draw();
    };
    const dl = el.querySelector(".dlist");
    if (item.condition === "defect") {
      item.defects.forEach(d => dl.appendChild(defectBox(item, d, draw)));
      const add = document.createElement("a");
      add.className = "addphoto"; add.textContent = "+ TILFØJ ENDNU EN FEJL";
      add.onclick = () => { item.defects.push({ id:uid(), text:"", severity:"Funktionel", photos:[], createdAt:new Date().toISOString() }); save(); draw(); };
      dl.appendChild(add);
    }
  };
  draw();
  return el;
}

function defectBox(item, d, redraw) {
  const box = document.createElement("div");
  box.className = "defectbox";
  box.innerHTML = `
    <textarea rows="2" placeholder="Beskriv fejlen…">${esc(d.text)}</textarea>
    <div class="row2" style="margin-top:8px">
      <select>${SEVS.map(s => `<option${s===d.severity?" selected":""}>${s}</option>`).join("")}</select>
      <label class="addphoto" style="margin:0;align-self:center">📷 TILFØJ FOTOS
        <input type="file" accept="image/*" capture="environment" multiple></label>
    </div>
    <div class="thumbs"></div>
    <a class="addphoto" style="color:var(--stamp)">SLET FEJLEN</a>
    <p class="small" style="margin-top:6px">Start med et oversigtsbillede, så nærbilleder.</p>`;
  box.querySelector("textarea").oninput = e => { d.text = e.target.value; save(); };
  box.querySelector("select").onchange = e => { d.severity = e.target.value; save(); };
  box.querySelector("input[type=file]").onchange = async e => {
    for (const f of e.target.files) d.photos.push(await processFile(f));
    save(); drawThumbs();
  };
  box.querySelector("a[style*='stamp']").onclick = () => {
    if (!confirm("Slet denne fejl og dens fotos?")) return;
    d.photos.forEach(delPhoto);
    item.defects = item.defects.filter(x => x.id !== d.id);
    if (!item.defects.length) item.condition = "ok";
    save(); redraw();
  };
  const drawThumbs = async () => {
    const t = box.querySelector(".thumbs");
    t.innerHTML = "";
    for (const pid of d.photos) {
      const url = await photoURL(pid);
      if (!url) continue;
      const w = document.createElement("div");
      w.className = "t";
      w.innerHTML = `<img src="${url}" alt=""><button class="x">×</button>`;
      w.querySelector(".x").onclick = () => { delPhoto(pid); d.photos = d.photos.filter(p => p !== pid); save(); drawThumbs(); };
      t.appendChild(w);
    }
  };
  drawThumbs();
  return box;
}

function renderMeters() {
  view.innerHTML = `<div class="crumb"><a id="back">← Oversigt</a> · MÅLERSTANDE</div><div id="list"></div>`;
  document.getElementById("back").onclick = () => go({ screen: "overview" });
  const list = document.getElementById("list");
  S.meters.forEach(m => {
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `<h3>${esc(m.type)}</h3>
      <label class="f">Aflæsning (præcis som måleren viser)</label>
      <input inputmode="decimal" value="${esc(m.value)}">
      <label class="addphoto">📷 ${m.photoId ? "NYT FOTO AF MÅLEREN" : "FOTOGRAFÉR MÅLEREN"}
        <input type="file" accept="image/*" capture="environment"></label>
      <div class="thumbs"></div>`;
    c.querySelector("input[inputmode]").oninput = e => { m.value = e.target.value.trim(); m.readAt = new Date().toISOString(); save(); };
    c.querySelector("input[type=file]").onchange = async e => {
      if (!e.target.files[0]) return;
      if (m.photoId) delPhoto(m.photoId);
      m.photoId = await processFile(e.target.files[0]);
      save(); drawT();
    };
    const drawT = async () => {
      const t = c.querySelector(".thumbs");
      t.innerHTML = "";
      if (m.photoId) {
        const url = await photoURL(m.photoId);
        if (url) t.innerHTML = `<div class="t"><img src="${url}" alt=""></div>`;
      }
    };
    drawT();
    list.appendChild(c);
  });
}

function renderReport() {
  const defects = allDefects();
  view.innerHTML = `
    <div class="crumb"><a id="back">← Oversigt</a> · RAPPORT</div>
    <div class="card"><h3>Din indflytningsrapport</h3>
      <p class="small" style="margin-top:6px">${S.rooms.length} rum · ${defects.length} fejl/mangler ·
      ${allPhotoIds().length} fotos. Rapporten dannes i din browser og gemmes/printes som PDF.
      Fotosættets fingeraftryk registreres hos Indflyt med servertid (bevis-anker), så det kan
      påvises, at rapporten ikke er lavet senere.</p>
      <button class="btn" id="gen">Generér rapporten (print / gem som PDF)</button>
      <p class="small" style="margin-top:10px">📮 <strong>Send den til din udlejer i dag</strong> — og en kopi
      til din egen e-mail. Selve afsendelsen dokumenterer datoen uafhængigt.</p>
    </div>
    <div class="card"><h3>Få besked når appen kommer</h3>
      <p class="small">iOS-appen med kamera-flow og arkiv lanceres 1. august.</p>
      <form method="POST" action="${WORKER}/signup">
        <input type="hidden" name="v" value="webapp"><input type="hidden" name="price" value="99">
        <label class="f">Din e-mail (valgfrit)</label><input type="email" name="email" placeholder="din@mail.dk">
        <button class="btn sec" type="submit">Skriv mig op</button>
      </form>
    </div>`;
  document.getElementById("back").onclick = () => go({ screen: "overview" });
  document.getElementById("gen").onclick = generateReport;
}

// ---------- the report ----------
async function generateReport() {
  const btn = document.getElementById("gen");
  btn.disabled = true; btn.textContent = "Danner rapport…";

  // manifest over the stored photo bytes
  const photoIds = allPhotoIds();
  const metas = [];
  for (const id of photoIds) {
    const rec = await getPhoto(id);
    if (rec) metas.push({ id, sha256: rec.sha256, capturedAt: rec.capturedAt });
  }
  const manifestText = metas.map(m => `${m.id}:${m.sha256}`).sort().join("\n");
  const manifestHash = await sha256Hex(new TextEncoder().encode(manifestText));

  // bevis-anker (best effort — report still generates offline)
  if (!S.anchor || S.anchor.hash !== manifestHash) {
    try {
      const r = await fetch(`${WORKER}/anchor`, { method:"POST", body: manifestHash });
      if (r.ok) { S.anchor = await r.json(); save(); }
    } catch(e) { /* offline: anchor marked missing below */ }
  }

  const today = new Date().toISOString();
  const sevCount = s => allDefects().filter(d => d.severity === s).length;
  const photoBlock = async (ids, caption) => {
    let html = "";
    for (const pid of ids) {
      const url = await photoURL(pid);
      const meta = metas.find(m => m.id === pid);
      if (url) html += `<div class="ph"><img src="${url}"><div class="cap">${caption} · ${esc(fmtTs(meta?.capturedAt || today))}</div></div>`;
    }
    return html;
  };

  let roomsHtml = "";
  for (const r of S.rooms) {
    roomsHtml += `<h2>${esc(r.name)}</h2><table>${r.items.map(i =>
      `<tr><td>${esc(i.title)}</td><td>${COND_LABEL[i.condition]}</td></tr>`).join("")}</table>`;
    if (r.note) roomsHtml += `<p style="font-size:10pt;font-style:italic">Note: ${esc(r.note)}</p>`;
    for (const i of r.items) for (const d of i.defects) {
      roomsHtml += `<p style="font-size:10.5pt;margin-top:8pt"><strong>${esc(i.title)} — ${esc(d.severity)}:</strong> ${esc(d.text)}</p>`;
      roomsHtml += await photoBlock(d.photos, "Foto");
    }
  }

  let metersHtml = `<table>${S.meters.map(m =>
    `<tr><td>${esc(m.type)}${m.readAt ? ` (aflæst ${esc(fmtTs(m.readAt))})` : ""}</td><td>${esc(m.value) || "Ikke aflæst"}</td></tr>`).join("")}</table>`;
  for (const m of S.meters) if (m.photoId) metersHtml += await photoBlock([m.photoId], esc(m.type));

  const defects = allDefects();
  const listHtml = defects.length
    ? `<ol>${defects.map(d => `<li><strong>${esc(d.room)} — ${esc(d.item)}:</strong> ${esc(d.text)} <em>(${esc(d.severity.toLowerCase())})</em></li>`).join("")}</ol>`
    : "<p>Der blev ikke konstateret fejl eller mangler ved gennemgangen.</p>";

  const anchorHtml = S.anchor && S.anchor.hash === manifestHash
    ? `Manifest-hash forankret hos Indflyt ${esc(fmtTs(S.anchor.anchoredAt))} (servertid).
       Verificér: ${WORKER}/anchor/${manifestHash}`
    : "Manifest-hash er ikke forankret (ingen forbindelse ved dannelsen) — generér rapporten igen med netadgang for tidsforankring.";

  document.getElementById("doc").innerHTML = `
    <h1>INDFLYTNINGSRAPPORT</h1>
    <div class="meta">
      <div><span>Lejemål</span><strong>${esc(S.addressLine)}, ${esc(S.postalCode)} ${esc(S.city)}</strong></div>
      <div><span>Overtagelsesdato</span><strong>${fmtDate(S.takeoverDate)}</strong></div>
      ${S.tenantName ? `<div><span>Lejer</span><strong>${esc(S.tenantName)}</strong></div>` : ""}
      ${S.landlordName ? `<div><span>Udlejer</span><strong>${esc(S.landlordName)}</strong></div>` : ""}
      <div><span>Rapportdato</span><strong>${fmtDate(today)}</strong></div>
    </div>
    <h2>Resumé</h2>
    <table><tr><td>Antal rum</td><td>${S.rooms.length}</td></tr>
    <tr><td>Fejl og mangler i alt</td><td>${defects.length}</td></tr>
    ${SEVS.map(s => `<tr><td>heraf ${s.toLowerCase()}</td><td>${sevCount(s)}</td></tr>`).join("")}</table>
    ${roomsHtml}
    <h2>Målerstande</h2>${metersHtml}
    <div class="pagebreak"></div>
    <h2>Fejl- og mangelliste</h2>
    <p style="font-size:10pt">Nedenstående er konstateret ved overtagelsen af lejemålet
    ${esc(S.addressLine)} den ${fmtDate(S.takeoverDate)} (frist for fremsendelse, jf. lejelovens § 91:
    ${fmtDate(addDays(S.takeoverDate, 14))}).</p>
    ${listHtml}
    <h2>Dokumentation</h2>
    ${metas.map(m => `<div class="mono">${m.id}.jpg · ${esc(fmtTs(m.capturedAt))} · SHA-256: ${m.sha256}</div>`).join("")}
    <div class="mono" style="margin-top:6pt"><strong>Manifest-hash:</strong> ${manifestHash}</div>
    <div class="mono">${anchorHtml}</div>
    <div class="disc">Denne rapport er udarbejdet af lejeren som egen dokumentation af lejemålets stand
    ved indflytning. SHA-256-hashværdierne dokumenterer, at billederne og rapporten er uændrede, siden
    rapporten blev dannet. Tidsforankringen og rapportens afsendelse til udlejer eller egen e-mail
    dokumenterer datoen uafhængigt. Udarbejdet med Indflyt (gratis webudgave).</div>`;

  // let the photos decode before printing
  await Promise.all([...document.querySelectorAll("#doc img")].map(img => img.decode().catch(() => {})));
  btn.disabled = false; btn.textContent = "Generér rapporten (print / gem som PDF)";
  window.print();
}

// ---------- .ics reminder ----------
function downloadICS() {
  const dl = addDays(S.takeoverDate, 14);
  const ev = (date, title) =>
    `BEGIN:VEVENT\r\nUID:${uid()}@indflyt\r\nDTSTART;VALUE=DATE:${date.replaceAll("-","")}\r\nSUMMARY:${title}\r\nEND:VEVENT\r\n`;
  const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Indflyt//DA\r\n" +
    ev(addDays(S.takeoverDate,10), "Indflyt: 4 dage til fristen for fejl- og mangellisten") +
    ev(addDays(S.takeoverDate,13), `Indflyt: I MORGEN (${fmtDate(dl)}) er sidste frist — send listen til udlejer`) +
    "END:VCALENDAR\r\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type:"text/calendar" }));
  a.download = "indflyt-frist.ics";
  a.click();
}

// ---------- boot ----------
document.getElementById("resetbtn").onclick = async () => {
  if (!S || !confirm("Slet hele gennemgangen inkl. fotos og start forfra?")) return;
  await clearPhotos();
  localStorage.removeItem(STATE_KEY);
  S = null;
  go({ screen: "start" });
};
load();
render();
fetch(`${WORKER}/hit?v=webapp`, { mode:"no-cors" }).catch(() => {});
