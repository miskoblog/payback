"use strict";

/* =====================================================================
   Payback — static, client-side only. No API calls, no backend.
   All state lives in this browser's localStorage under the "payback_" prefix.
   ===================================================================== */

const GATE_HASH = "3511791914bcd75ad930177c29d9a1e0bfccd3797a1d6341491269afff936afa";
const LS = "payback_";

/* ---------- storage + small utils ---------- */
function lsGet(k, d) {
  try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
}
function lsSet(k, v) {
  try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
}
function n(x) { const v = Number(x); return isFinite(v) ? v : 0; }
function isNum(x) { return x !== "" && x != null && isFinite(Number(x)); }
function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function round2(x) { return Math.round(x * 100) / 100; }
function fmtInt(x) { return Math.round(n(x)).toLocaleString("en-US"); }
function fmtMoney(x) { return (x < 0 ? "-$" : "$") + Math.abs(Math.round(n(x))).toLocaleString("en-US"); }
function fmtMoney2(x) { return (x < 0 ? "-$" : "$") + Math.abs(n(x)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmt1(x) { return (Math.round(n(x) * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 }); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pearson(xs, ys) {
  const len = xs.length;
  if (len < 3) return null;
  const mx = sum(xs) / len, my = sum(ys) / len;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < len; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML.replace(/"/g, "&quot;");
}
const esc = escapeHtml;

/* Splits `total` dollars across weights in whole cents (largest remainder). */
function allocCents(total, weights) {
  const cents = Math.round(total * 100), W = sum(weights);
  if (!weights.length || W <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (cents * w) / W);
  const out = raw.map(Math.floor);
  let left = cents - sum(out);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1;
  return out.map((c) => c / 100);
}

/* =====================================================================
   COMPUTE: CreditMap
   ===================================================================== */
const RATE_ORDER = ["post", "image", "scored", "competitor", "short", "ad", "wb", "doc", "spk", "music"];
// Defaults come from the worked examples on the Postonomous sales page
// (Month A = 990 credits per business; Month B = 1,980 + 1,290 + 805 + 535 = 4,610).
const DEFAULT_RATES = {
  post: { label: "Post, per network", cost: 3, text: true },
  image: { label: "Branded image", cost: 30, text: false },
  scored: { label: "Post scored (WinScore)", cost: 8, text: false },
  competitor: { label: "Competitor check (30 posts)", cost: 105, text: false },
  short: { label: "Viral short video", cost: 175, text: false },
  ad: { label: "15-second ad", cost: 90, text: false },
  wb: { label: "Whiteboard video, per minute", cost: 125, text: false },
  doc: { label: "Documentary video, per minute", cost: 255, text: false },
  spk: { label: "Spokesperson video, per minute", cost: 495, text: false },
  music: { label: "Music, per long video", cost: 40, text: false },
};
function getRates() {
  const saved = lsGet("ratecard", null), r = clone(DEFAULT_RATES);
  if (saved) RATE_ORDER.forEach((k) => { if (saved[k]) { r[k].cost = n(saved[k].cost); r[k].text = !!saved[k].text; } });
  return r;
}

function computeCredits(q, rates, byo) {
  rates = rates || DEFAULT_RATES;
  const qty = {
    post: n(q.posts) * n(q.networks), image: n(q.images), scored: n(q.scored), competitor: n(q.competitor),
    short: n(q.short), ad: n(q.ad), wb: n(q.wb), doc: n(q.doc), spk: n(q.spk), music: n(q.musicvids),
  };
  const lines = RATE_ORDER.filter((k) => qty[k] > 0).map((k) => {
    const r = rates[k], free = !!(byo && r.text);
    return { key: k, label: r.label, qty: qty[k], unit: n(r.cost), credits: free ? 0 : qty[k] * n(r.cost), free };
  });
  return { lines, total: sum(lines.map((l) => l.credits)) };
}

const POOLS = [
  { id: "bundle", label: "Bundle", pool: 5000, brands: 10 },
  { id: "lite", label: "Mega Bundle Lite", pool: 7000, brands: 50 },
  { id: "mega", label: "Mega Bundle", pool: 10000, brands: Infinity },
];
function splitPool(state) { return state.pool === "custom" ? n(state.customPool) : n(state.pool); }

function computeSplit(state) {
  const pool = splitPool(state);
  const brands = (state.brands || []).map((b, i) => ({
    i, name: (b.name || "").trim() || "Brand " + (i + 1), fee: Math.max(0, n(b.fee)),
    need: Math.max(0, n(b.need)), priority: n(b.priority) > 0 ? n(b.priority) : 1,
  }));
  if (!brands.length) return null;
  const fees = brands.filter((b) => b.fee > 0).map((b) => b.fee);
  const avgFee = fees.length ? sum(fees) / fees.length : 1;
  brands.forEach((b) => { b.weight = b.priority * (b.fee > 0 ? b.fee : avgFee); });
  const totalNeed = sum(brands.map((b) => b.need));
  let alloc;
  if (totalNeed <= pool) {
    alloc = brands.map((b) => b.need);
  } else {
    // water-filling: brands that need less than their weighted share keep only what they need
    const fixed = brands.map(() => null);
    let active = brands.filter((b) => b.need > 0).map((b) => b.i), remaining = pool;
    while (active.length) {
      const tw = sum(active.map((i) => brands[i].weight));
      let satisfied = false;
      active.forEach((i) => { if ((remaining * brands[i].weight) / tw >= brands[i].need) { fixed[i] = brands[i].need; satisfied = true; } });
      if (!satisfied) { active.forEach((i) => { fixed[i] = (remaining * brands[i].weight) / tw; }); break; }
      remaining = pool - sum(fixed.filter((f) => f !== null));
      active = active.filter((i) => fixed[i] === null);
    }
    alloc = fixed.map((f) => (f === null ? 0 : f));
    // whole credits, largest remainder among brands still short
    const fl = alloc.map(Math.floor);
    let left = Math.round(sum(alloc)) - sum(fl);
    const order = alloc.map((a, i) => ({ i, f: a - Math.floor(a) })).filter((o) => fl[o.i] < brands[o.i].need).sort((a, b) => b.f - a.f || a.i - b.i);
    for (let k = 0; left > 0 && k < order.length; k++, left--) fl[order[k].i] += 1;
    alloc = fl;
  }
  const rows = brands.map((b, k) => ({
    name: b.name, fee: b.fee, need: b.need, priority: b.priority, alloc: alloc[k], short: Math.max(0, b.need - alloc[k]),
    perFee: b.fee > 0 && alloc[k] > 0 ? b.fee / alloc[k] : null,
  }));
  const options = POOLS.map((p) => ({ label: p.label, pool: p.pool, brands: p.brands }));
  if (state.pool === "custom") options.push({ label: "Your number", pool: pool, brands: Infinity });
  const fit = options.map((p) => ({
    label: p.label, pool: p.pool, brandLimit: p.brands,
    fits: totalNeed <= p.pool, brandOk: brands.length <= p.brands,
    headroom: p.pool - totalNeed, short: Math.max(0, totalNeed - p.pool),
  }));
  const smallest = fit.find((f) => f.fits && f.brandOk) || null;
  return { pool, totalNeed, shortfall: Math.max(0, totalNeed - pool), surplus: Math.max(0, pool - totalNeed), rows, fit, smallest };
}

function computeTracker(state, splitResult) {
  const pool = n(state.pool), days = Math.max(1, Math.round(n(state.days)) || 30);
  const day = clamp(Math.round(n(state.day)) || 1, 1, days);
  const log = (state.log || []).filter((e) => n(e.credits) !== 0);
  const planRows = splitResult && splitResult.rows.length
    ? splitResult.rows.map((r) => ({ name: r.name, planned: r.alloc }))
    : [{ name: "All brands", planned: pool }];
  const names = planRows.map((r) => r.name);
  log.forEach((e) => { const b = e.brand || "All brands"; if (!names.includes(b)) { names.push(b); planRows.push({ name: b, planned: 0, unplanned: true }); } });
  const rows = planRows.map((p) => {
    const spent = sum(log.filter((e) => (e.brand || "All brands") === p.name).map((e) => n(e.credits)));
    const expected = (p.planned * day) / days, projected = (spent / day) * days;
    let status = "on";
    if (p.planned === 0 && spent > 0) status = "over";
    else if (projected > p.planned * 1.05) status = "over";
    else if (projected < p.planned * 0.8) status = "under";
    return { name: p.name, planned: p.planned, spent, expected, projected, status, unused: Math.max(0, p.planned - projected), unplanned: !!p.unplanned };
  });
  const spent = sum(rows.map((r) => r.spent)), projected = (spent / day) * days;
  return {
    pool, days, day, rows, spent, remaining: pool - spent, projected,
    expiring: Math.max(0, pool - projected), overrun: Math.max(0, projected - pool),
    hasPlan: !!(splitResult && splitResult.rows.length),
  };
}

/* =====================================================================
   COMPUTE: Retainer
   ===================================================================== */
const TYPE_MULT = { cafe: 0.6, dentist: 1.4, gym: 0.7, salon: 0.7, realtor: 1.2, contractor: 0.9, bookkeeper: 1.0, coach: 1.0, other: 0.85 };
const TYPE_LABEL = { cafe: "Café or bakery", dentist: "Dentist or clinic", gym: "Gym or studio", salon: "Salon", realtor: "Realtor", contractor: "Contractor", bookkeeper: "Bookkeeper", coach: "Coach", other: "Local business" };
const MARKET_MULT = { small: 0.8, mid: 1.0, metro: 1.25 };
const BAND = { low: 500, high: 5000 }; // the range quoted on the Postonomous sales page
const PRICE_TIERS = [{ id: "good", name: "Good", scale: 0.6 }, { id: "better", name: "Better", scale: 1 }, { id: "best", name: "Best", scale: 1.5 }];
function ceil25(x) { return Math.ceil(Math.round(x * 1000) / 1000 / 25) * 25; }

function computePricing(s, rates) {
  rates = rates || getRates();
  if (n(s.posts) + n(s.shorts) + n(s.longCount) <= 0) return null;
  const nets = Math.max(1, n(s.networks)), creditValue = n(s.tool) / (Math.max(1, n(s.amort)) * Math.max(1, n(s.pool)));
  const margin = clamp(n(s.margin), 0, 90) / 100, tiers = [];
  let prev = 0;
  PRICE_TIERS.forEach((t) => {
    const posts = Math.round(n(s.posts) * t.scale), images = Math.round(n(s.images) * t.scale);
    const shorts = Math.round(n(s.shorts) * t.scale), longCount = Math.round(n(s.longCount) * t.scale);
    const q = { posts, networks: nets, images, scored: s.scoreAll ? posts : 0, short: shorts, musicvids: longCount };
    q[s.style || "wb"] = longCount * n(s.longMin);
    const c = computeCredits(q, rates, false);
    const hours = isNum(s.hours) && n(s.hours) > 0 ? n(s.hours) * t.scale : 2 + 0.1 * posts + 0.5 * shorts + 1 * longCount;
    const cost = hours * n(s.rate) + c.total * creditValue;
    const floor = cost / (1 - margin);
    const units = posts * nets * 0.5 + shorts * 4 + longCount * n(s.longMin) * 3;
    const raw = BAND.low + (BAND.high - BAND.low) * clamp(units / 150, 0, 1);
    const market = clamp(Math.round(raw * (TYPE_MULT[s.type] || 0.85) * (MARKET_MULT[s.market] || 1)), BAND.low, BAND.high);
    let price = ceil25(Math.max(floor, market)), stepped = false;
    if (prev && price < ceil25(prev * 1.1)) { price = ceil25(prev * 1.1); stepped = true; }
    prev = price;
    tiers.push({
      id: t.id, name: t.name, posts, networks: nets, images, shorts, longCount, longMin: n(s.longMin), style: s.style || "wb",
      credits: c.total, hours, cost, floor, market, price, profit: price - cost,
      marginPct: price > 0 ? ((price - cost) / price) * 100 : 0, basis: stepped ? "step" : floor > market ? "floor" : "market",
    });
  });
  return { tiers };
}

function computeMargin(s) {
  const price = n(s.price), clients = Math.max(1, Math.round(n(s.clients)) || 1), tool = n(s.tool);
  if (price <= 0) return null;
  const timeCost = s.countTime ? n(s.hours) * n(s.rate) : 0, overhead = n(s.overhead), credits = n(s.credits), pool = n(s.pool);
  function scenario(c) {
    const revenue = price * c, time = timeCost * c, net = revenue - time - overhead;
    return { clients: c, revenue, time, overhead, net, perClient: net / c, recoupMonths: net > 0 ? tool / net : null, firstMonthAfterTool: net - tool, creditsUsed: credits * c, fits: credits * c <= pool };
  }
  const counts = Array.from(new Set([1, 5, 10, clients])).sort((a, b) => a - b);
  const one = scenario(1);
  return {
    price, tool, timeCost, scenarios: counts.map(scenario), custom: clients,
    maxClients: credits > 0 ? Math.floor(pool / credits) : null,
    claim: {
      oneRevenue: price, oneCoversByRevenue: price >= tool, oneNet: one.net, oneCoversAfterCosts: one.net >= tool,
      tenRevenue: price * 10,
    },
  };
}

function computeAudit(s, tiers, cut) {
  const scores = ["s1", "s2", "s3", "s4", "s5"].map((k) => s[k]).filter(isNum).map((v) => clamp(Number(v), 0, 100));
  if (!scores.length) return null;
  const avg = sum(scores) / scores.length, min = Math.min(...scores), max = Math.max(...scores);
  const rewritten = isNum(s.rewritten) ? clamp(Number(s.rewritten), 0, 100) : null;
  let price = null, tierName = null;
  if (s.tier === "custom") { price = n(s.customPrice) > 0 ? n(s.customPrice) : null; tierName = "Custom"; }
  else if (s.tier !== "none") {
    const t = (tiers || []).find((x) => x.id === s.tier);
    if (t) { price = t.price; tierName = t.name; }
  }
  const verdicts = scores.map((v) => (v < cut.fix ? "Fix first" : v < cut.promote ? "Not yet" : "Strong"));
  return {
    scores, verdicts, avg, min, max, spread: max - min, fixFirst: scores.filter((v) => v < cut.fix).length,
    belowBar: scores.filter((v) => v < cut.promote).length, gap: Math.max(0, cut.promote - avg),
    rewritten, lift: rewritten == null ? null : rewritten - min, price, tierName,
    tierDetail: price != null ? (tiers || []).find((x) => x.id === s.tier) || null : null, cut,
  };
}

/* =====================================================================
   COMPUTE: Proven
   ===================================================================== */
function getCutoffs() {
  const c = lsGet("cutoffs", null);
  return { fix: c ? n(c.fix) : 50, promote: c ? n(c.promote) : 70 };
}
function tierOf(score, cut) { return score < cut.fix ? "fix" : score < cut.promote ? "notyet" : "promote"; }
const TIER_LABEL = { fix: "Fix it first", notyet: "Not yet", promote: "Worth promoting", unscored: "No score" };

function computeBudgetSplit(s) {
  const budget = Math.max(0, n(s.budget)), reservePct = clamp(n(s.reserve), 0, 100);
  const fix = n(s.fix), promote = Math.max(n(s.promote), fix);
  const cut = { fix, promote };
  const drafts = (s.drafts || []).map((d, i) => ({ i, label: (d.label || "").trim() || "Draft " + (i + 1), score: d.score, ok: isNum(d.score) }))
    .filter((d) => d.ok).map((d) => ({ i: d.i, label: d.label, score: clamp(Number(d.score), 0, 100) }));
  if (!drafts.length || budget <= 0) return null;
  drafts.forEach((d) => { d.tier = tierOf(d.score, cut); d.amount = 0; });
  const reserve = round2((budget * reservePct) / 100), pool = round2(budget - reserve);
  const promo = drafts.filter((d) => d.tier === "promote");
  let heldPool = 0, heldReserve = 0;
  if (promo.length) {
    const amounts = allocCents(pool, promo.map((d) => (d.score - fix + 1) ** 2));
    promo.forEach((d, k) => { d.amount = amounts[k]; });
  } else heldPool = pool;
  const notYet = drafts.filter((d) => d.tier === "notyet");
  let testDraft = null;
  if (notYet.length) {
    testDraft = notYet.reduce((best, d) => (d.score > best.score ? d : best), notYet[0]);
    testDraft.amount = round2(testDraft.amount + reserve);
    testDraft.isTest = true;
  } else heldReserve = reserve;
  drafts.forEach((d) => {
    d.share = budget > 0 ? (d.amount / budget) * 100 : 0;
    d.action = d.tier === "fix" ? "Send back to Champion Mode, then re-score"
      : d.tier === "promote" ? "Promote"
      : d.isTest ? "Test slice only; improve, then re-score" : "Improve, then re-score";
  });
  const allocated = round2(sum(drafts.map((d) => d.amount)));
  return { budget, reserve, pool, drafts, cut, allocated, heldPool, heldReserve, held: round2(budget - allocated), promoCount: promo.length };
}

const MIN_CAL = 8;
function computeCalibration(s, cut) {
  const e = (s.entries || []).filter((x) => isNum(x.score) && isNum(x.result))
    .map((x, i) => ({ label: (x.label || "").trim() || "Post " + (i + 1), score: clamp(Number(x.score), 0, 100), result: Number(x.result) }));
  const count = e.length;
  if (count < 2) return null;
  const med = median(e.map((x) => x.result)), r = pearson(e.map((x) => x.score), e.map((x) => x.result));
  const band = (list) => {
    const hits = list.filter((x) => x.result > med).length;
    return { count: list.length, median: list.length ? median(list.map((x) => x.result)) : null, hits, hitRate: list.length ? hits / list.length : null };
  };
  const bands = { fix: band(e.filter((x) => x.score < cut.fix)), notyet: band(e.filter((x) => x.score >= cut.fix && x.score < cut.promote)), promote: band(e.filter((x) => x.score >= cut.promote)) };
  let trust;
  if (count < MIN_CAL) trust = { key: "few", label: "Not enough posts yet (need " + MIN_CAL + ")" };
  else if (r == null) trust = { key: "none", label: "No clear link" };
  else if (r >= 0.5) trust = { key: "strong", label: "Strong link" };
  else if (r >= 0.3) trust = { key: "moderate", label: "Moderate link" };
  else if (r >= 0.1) trust = { key: "weak", label: "Weak link" };
  else trust = { key: "none", label: "No clear link" };
  let suggest = null;
  if (count >= MIN_CAL) {
    const minGroup = Math.max(3, Math.ceil(count * 0.2));
    let bestP = null;
    for (let t = 50; t <= 90; t += 5) {
      const g = e.filter((x) => x.score >= t);
      if (g.length < minGroup) continue;
      const hr = g.filter((x) => x.result > med).length / g.length;
      if (!bestP || hr > bestP.hitRate) bestP = { promote: t, hitRate: hr, count: g.length };
    }
    let bestF = null;
    for (let t = 30; t <= 70; t += 5) {
      const g = e.filter((x) => x.score < t);
      if (g.length < 3) continue;
      const hr = g.filter((x) => x.result > med).length / g.length;
      if (hr <= 0.25) bestF = { fix: t, hitRate: hr, count: g.length };
    }
    if (bestP) {
      let fix = cut.fix, fixHit = null, fixFound = false;
      if (bestF) {
        const f = Math.min(bestF.fix, bestP.promote), g = e.filter((x) => x.score < f);
        if (g.length) { fix = f; fixHit = g.filter((x) => x.result > med).length / g.length; fixFound = true; }
      }
      suggest = { promote: bestP.promote, promoteHit: bestP.hitRate, promoteCount: bestP.count, fix: Math.min(fix, bestP.promote), fixFound, fixHit };
    }
  }
  return { count, median: med, r, bands, trust, suggest, cut, entries: e };
}

function computeLedger(s, cut, cal) {
  const rows = (s.rows || []).filter((x) => isNum(x.spend)).map((x, i) => ({
    label: (x.label || "").trim() || "Post " + (i + 1), score: isNum(x.score) ? clamp(Number(x.score), 0, 100) : null,
    spend: Math.max(0, Number(x.spend)), results: isNum(x.results) ? Math.max(0, Number(x.results)) : null,
  }));
  if (!rows.length) return null;
  rows.forEach((r) => { r.tier = r.score == null ? "unscored" : tierOf(r.score, cut); });
  const agg = (list) => {
    const measured = list.filter((r) => r.results != null);
    const spend = sum(list.map((r) => r.spend)), mSpend = sum(measured.map((r) => r.spend)), results = sum(measured.map((r) => r.results));
    return { posts: list.length, spend, measuredSpend: mSpend, results, cpr: results > 0 ? mSpend / results : null };
  };
  const tiers = {};
  ["promote", "notyet", "fix", "unscored"].forEach((t) => { tiers[t] = agg(rows.filter((r) => r.tier === t)); });
  const overall = agg(rows);
  const rest = agg(rows.filter((r) => r.tier !== "promote"));
  let versus = null;
  if (tiers.promote.cpr != null && rest.cpr != null) versus = { promoteCpr: tiers.promote.cpr, restCpr: rest.cpr, ratio: rest.cpr / tiers.promote.cpr };
  let calCompare = null;
  if (cal && cal.suggest) {
    const t = cal.suggest.promote;
    const hi = agg(rows.filter((r) => r.score != null && r.score >= t)), lo = agg(rows.filter((r) => r.score != null && r.score < t));
    calCompare = { cutoff: t, hi, lo };
  }
  return { rows, tiers, overall, versus, calCompare, cut };
}

/* =====================================================================
   UI helpers
   ===================================================================== */
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 1800);
}
function copyText(text) {
  const done = () => showToast("Copied");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { showToast("Copy not available"); }
  document.body.removeChild(ta);
}
function formatSavedAt(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function initSaveable({ toolId, listEl, getEntry, applyEntry, max = 50 }) {
  const key = "saved_" + toolId;
  const read = () => lsGet(key, []);
  const write = (entries) => { lsSet(key, entries.slice(0, max)); render(); };
  function render() {
    const entries = read();
    if (!entries.length) {
      listEl.innerHTML = '<p class="saved-empty">Nothing saved yet — fill in the tool, then press Save.</p>';
      return;
    }
    listEl.innerHTML = entries.map((e) => `
      <div class="saved-item" data-id="${esc(e.id)}">
        <div class="saved-item-main">
          <div class="saved-item-name">${esc(e.name)}</div>
          <div class="saved-item-meta">${esc(e.meta)} · ${esc(formatSavedAt(e.savedAt))}</div>
        </div>
        <div class="saved-actions">
          <button class="ghost-btn" type="button" data-act="open">Open</button>
          <button class="ghost-btn" type="button" data-act="delete">Delete</button>
        </div>
      </div>`).join("");
  }
  listEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    const id = btn.closest(".saved-item").dataset.id;
    const entry = read().find((e) => e.id === id);
    if (!entry) return;
    if (btn.dataset.act === "open") { applyEntry(entry.payload); showToast("Opened"); }
    else { write(read().filter((e) => e.id !== id)); showToast("Deleted"); }
  });
  render();
  return {
    save() {
      const entry = getEntry();
      if (!entry) { showToast("Nothing to save yet"); return; }
      write([{ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), savedAt: new Date().toISOString(), ...entry }, ...read()]);
      showToast("Saved");
    },
  };
}

/* Editable rows (brands, drafts, log entries ...) */
function rowsEditor({ el, cols, get, onChange, newRow, addBtn }) {
  const box = document.querySelector(el);
  function cell(c, r, i) {
    const val = r[c.k] == null ? "" : r[c.k];
    const aria = esc(c.label + " row " + (i + 1));
    if (c.type === "select") {
      const opts = c.options(r).map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val) ? " selected" : ""}>${esc(l)}</option>`).join("");
      return `<select data-i="${i}" data-c="${c.k}" aria-label="${aria}">${opts}</select>`;
    }
    const attrs = c.type === "number" ? ` min="${c.min != null ? c.min : 0}"${c.max != null ? ` max="${c.max}"` : ""}${c.step ? ` step="${c.step}"` : ""}` : "";
    return `<input type="${c.type}" data-i="${i}" data-c="${c.k}" value="${esc(val)}" placeholder="${esc(c.ph || "")}" aria-label="${aria}"${attrs} />`;
  }
  function render() {
    const rows = get();
    if (!rows.length) { box.innerHTML = '<p class="saved-empty">None yet — use the button below.</p>'; return; }
    let h = '<div class="rows-scroll"><table class="rows"><thead><tr>' + cols.map((c) => `<th>${esc(c.label)}</th>`).join("") + "<th></th></tr></thead><tbody>";
    rows.forEach((r, i) => {
      h += "<tr>" + cols.map((c) => `<td style="min-width:${c.w || 70}px">${cell(c, r, i)}</td>`).join("") +
        `<td><button type="button" class="x-btn" data-del="${i}" aria-label="Remove row ${i + 1}">×</button></td></tr>`;
    });
    box.innerHTML = h + "</tbody></table></div>";
  }
  function handle(ev) {
    const t = ev.target;
    if (!t.dataset || t.dataset.c == null) return;
    const col = cols.find((c) => c.k === t.dataset.c), rows = get(), row = rows[Number(t.dataset.i)];
    if (!row) return;
    row[t.dataset.c] = col.type === "number" ? (t.value === "" ? "" : Number(t.value)) : t.value;
    onChange();
  }
  box.addEventListener("input", handle);
  box.addEventListener("change", handle);
  box.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-del]");
    if (!b) return;
    get().splice(Number(b.dataset.del), 1);
    render(); onChange();
  });
  if (addBtn) {
    document.querySelector(addBtn).addEventListener("click", () => {
      get().push(newRow(get())); render(); onChange();
      const inputs = box.querySelectorAll("tbody tr:last-child input, tbody tr:last-child select");
      if (inputs[0]) inputs[0].focus();
    });
  }
  render();
  return { render };
}

/* Generic tool wiring: inputs <-> state, live compute, render, Save/Open/Delete, Copy */
const ALL_TOOLS = [];
function createTool(cfg) {
  const root = document.getElementById(cfg.root);
  const tool = { cfg, root, rows: {}, result: null };
  const key = "state_" + cfg.id;
  tool.state = Object.assign(clone(cfg.defaults), lsGet(key, {}));
  const out = root.querySelector("[data-out]");

  tool.fill = function () {
    root.querySelectorAll("[data-k]").forEach((el) => {
      const v = tool.state[el.dataset.k];
      if (el.type === "checkbox") el.checked = !!v; else el.value = v == null ? "" : v;
    });
    Object.values(tool.rows).forEach((r) => r.render());
  };
  tool.update = function () {
    let r = null;
    try { r = cfg.compute(tool.state, tool); } catch (e) { console.error(cfg.id, e); }
    tool.result = r;
    out.innerHTML = r ? cfg.render(r, tool.state, tool) : `<p class="output-placeholder">${cfg.placeholder}</p>`;
    lsSet(key, tool.state);
    if (cfg.after) cfg.after(r, tool);
  };
  root.querySelectorAll("[data-k]").forEach((el) => {
    const h = () => {
      tool.state[el.dataset.k] = el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value;
      tool.update();
    };
    el.addEventListener("input", h);
    el.addEventListener("change", h);
  });
  (cfg.rowDefs || []).forEach((d) => {
    tool.rows[d.key] = rowsEditor({
      el: d.el, cols: d.cols, addBtn: d.addBtn, get: () => (tool.state[d.key] = tool.state[d.key] || []),
      onChange: () => tool.update(), newRow: d.newRow,
    });
  });
  const sv = initSaveable({
    toolId: cfg.id, listEl: root.querySelector("[data-saved]"),
    getEntry: () => { if (!tool.result) return null; const e = cfg.entry(tool.state, tool.result); return { name: e.name, meta: e.meta, payload: clone(tool.state) }; },
    applyEntry: (p) => { tool.state = Object.assign(clone(cfg.defaults), clone(p)); tool.fill(); tool.update(); },
  });
  root.querySelector("[data-save]").addEventListener("click", sv.save);
  root.querySelector("[data-copy]").addEventListener("click", () => {
    if (!tool.result) { showToast("Nothing to copy yet"); return; }
    copyText(cfg.text(tool.result, tool.state));
  });
  tool.fill();
  ALL_TOOLS.push(tool);
  return tool;
}
function refreshAll() { ALL_TOOLS.forEach((t) => t.update()); }

function tableHtml(headers, rows, opts) {
  opts = opts || {};
  const th = headers.map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.t)}</th>`).join("");
  const body = rows.map((r) => `<tr class="${r.cls || ""}">` + r.cells.map((c, i) => `<td class="${headers[i] && headers[i].num ? "num" : ""}">${c}</td>`).join("") + "</tr>").join("");
  return `<div class="table-wrap"><table class="data"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function stat(k, v) { return `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`; }
function badge(text, kind) { return `<span class="badge ${kind}">${esc(text)}</span>`; }
const DISCLAIMER = "Estimates for planning only — not a forecast, promise of earnings, or guarantee of results.";

/* =====================================================================
   TOOLS
   ===================================================================== */
let cmSplit, cmBuilder, cmTrack, rtPrice, rtMargin, rtAudit, pvSplit, pvCal, pvLedger;

/* ---------- CreditMap 1: Credit Budget Builder ---------- */
const MONTH_A = { name: "Sample café (sales-page Month A)", posts: 60, networks: 1, images: 8, scored: 25, competitor: 1, short: 1, ad: 1, musicvids: 0, wb: 0, doc: 0, spk: 0, byo: false };
const EMPTY_PKG = { name: "", posts: 0, networks: 1, images: 0, scored: 0, competitor: 0, short: 0, ad: 0, musicvids: 0, wb: 0, doc: 0, spk: 0, byo: false };

function initCreditBuilder() {
  cmBuilder = createTool({
    id: "cm_builder", root: "sub-cm-builder", defaults: clone(MONTH_A),
    placeholder: "Enter what this brand gets each month and the credit budget appears here.",
    compute: (s) => { const c = computeCredits(s, getRates(), s.byo); return c.lines.length ? { ...c, name: s.name, byo: s.byo } : null; },
    render: (r) => {
      const fit = POOLS.map((p) => {
        const per = r.total > 0 ? Math.floor(p.pool / r.total) : null;
        return { cells: [esc(p.label), fmtInt(p.pool), r.total > 0 ? fmt1(r.total / p.pool * 100) + "%" : "—", per == null ? "—" : per + " like this"] };
      });
      return `<div class="stat-row">${stat("Credits per month", fmtInt(r.total))}${stat("Share of 5,000", fmt1((r.total / 5000) * 100) + "%")}</div>` +
        tableHtml([{ t: "Line item" }, { t: "Qty", num: 1 }, { t: "Credits each", num: 1 }, { t: "Credits", num: 1 }],
          r.lines.map((l) => ({ cells: [esc(l.label) + (l.free ? " " + badge("own key: 0", "good") : ""), fmtInt(l.qty), fmtInt(l.unit), fmtInt(l.credits)] }))
            .concat([{ cls: "total", cells: ["Total", "", "", fmtInt(r.total)] }])) +
        '<div class="sub-h">How many of these fit each pool</div>' +
        tableHtml([{ t: "Pool" }, { t: "Credits", num: 1 }, { t: "This package uses", num: 1 }, { t: "Fits", num: 1 }], fit) +
        `<p class="note">Rates come from the Postonomous sales page's examples. Confirm them against your Billing page. ${DISCLAIMER}</p>`;
    },
    text: (r) => "Credit budget" + (r.name ? ": " + r.name : "") + "\n" +
      r.lines.map((l) => `${l.label}: ${l.qty} × ${l.unit} = ${l.credits}`).join("\n") + `\nTotal: ${r.total} credits per month`,
    entry: (s, r) => ({ name: (s.name || "Credit budget") + " — " + fmtInt(r.total) + " credits", meta: r.lines.length + " line items" }),
  });
  // rate card
  const box = document.getElementById("cmb-rates");
  function drawRates() {
    const rates = getRates();
    box.innerHTML = RATE_ORDER.map((k) => `<div class="rate-row"><label for="rate-${k}">${esc(rates[k].label)}</label>
      <input type="number" min="0" id="rate-${k}" data-rate="${k}" value="${rates[k].cost}" />
      <span class="t"><input type="checkbox" data-rate-text="${k}" ${rates[k].text ? "checked" : ""} aria-label="${esc(rates[k].label)} is a text action" title="Text action: 0 credits with your own AI key" />txt</span></div>`).join("");
  }
  drawRates();
  box.addEventListener("input", (ev) => {
    const rates = getRates(), k = ev.target.dataset.rate, kt = ev.target.dataset.rateText;
    if (k) rates[k].cost = n(ev.target.value);
    if (kt) rates[kt].text = ev.target.checked;
    lsSet("ratecard", rates); refreshAll();
  });
  box.addEventListener("change", (ev) => { if (ev.target.dataset.rateText) box.dispatchEvent(new Event("input")); });
  document.getElementById("cmb-rates-reset").addEventListener("click", () => {
    try { localStorage.removeItem(LS + "ratecard"); } catch (e) {}
    drawRates(); refreshAll(); showToast("Rate card reset");
  });
  document.getElementById("cmb-preset").addEventListener("click", () => { cmBuilder.state = clone(MONTH_A); cmBuilder.fill(); cmBuilder.update(); });
  document.getElementById("cmb-clear").addEventListener("click", () => { cmBuilder.state = clone(EMPTY_PKG); cmBuilder.fill(); cmBuilder.update(); });
  document.getElementById("cmb-addplan").addEventListener("click", () => {
    if (!cmBuilder.result) { showToast("Nothing to add yet"); return; }
    cmSplit.state.brands = cmSplit.state.brands || [];
    cmSplit.state.brands.push({ name: cmBuilder.state.name || "Brand " + (cmSplit.state.brands.length + 1), fee: "", need: cmBuilder.result.total, priority: 1 });
    cmSplit.rows.brands.render(); cmSplit.update(); showToast("Added to Brand Split");
  });
}

/* ---------- CreditMap 2: Brand Split & Plan-Fit ---------- */
function initCreditSplit() {
  cmSplit = createTool({
    id: "cm_split", root: "sub-cm-split",
    defaults: { pool: "5000", customPool: 5000, brands: [{ name: "Corner Café", fee: 600, need: 990, priority: 1 }, { name: "Bright Smiles", fee: 1200, need: 2200, priority: 1 }, { name: "Iron Gym", fee: 800, need: 2400, priority: 1 }] },
    placeholder: "Add at least one brand to see the split.",
    rowDefs: [{
      key: "brands", el: "#cms-rows", addBtn: "#cms-add", newRow: () => ({ name: "", fee: "", need: "", priority: 1 }),
      cols: [{ k: "name", label: "Brand", type: "text", ph: "Name", w: 110 }, { k: "fee", label: "Fee $/mo", type: "number", w: 70 }, { k: "need", label: "Credits needed", type: "number", w: 80 }, { k: "priority", label: "Priority", type: "number", min: 1, step: "0.5", w: 60 }],
    }],
    compute: (s) => computeSplit(s),
    render: (r) => {
      const call = r.shortfall > 0
        ? `<div class="callout warn">This plan needs <strong>${fmtInt(r.shortfall)}</strong> more credits than the pool holds. Credits were shared out by fee × priority; brands that need less than their share keep only what they need.</div>`
        : `<div class="callout">This plan fits the pool with <strong>${fmtInt(r.surplus)}</strong> credits to spare.</div>`;
      const rows = r.rows.map((b) => ({ cells: [esc(b.name), b.fee ? fmtMoney(b.fee) : "—", fmtInt(b.need), fmtInt(b.alloc), b.short > 0 ? badge("short " + fmtInt(b.short), "bad") : badge("covered", "good"), b.perFee ? fmtMoney2(b.perFee) : "—"] }));
      const fit = r.fit.map((f) => ({ cells: [esc(f.label), fmtInt(f.pool), f.brandLimit === Infinity ? "no set limit" : String(f.brandLimit), f.fits ? badge("Fits, " + fmtInt(f.headroom) + " spare", "good") : badge("Short by " + fmtInt(f.short), "bad"), f.brandOk ? badge("OK", "good") : badge("Too many brands", "bad")] }));
      return `<div class="stat-row">${stat("Pool", fmtInt(r.pool))}${stat("Needed", fmtInt(r.totalNeed))}${stat(r.shortfall > 0 ? "Shortfall" : "Spare", fmtInt(r.shortfall > 0 ? r.shortfall : r.surplus))}</div>` + call +
        tableHtml([{ t: "Brand" }, { t: "Fee", num: 1 }, { t: "Needs", num: 1 }, { t: "Gets", num: 1 }, { t: "Status" }, { t: "Fee per credit", num: 1 }], rows) +
        '<div class="sub-h">Plan fit</div>' +
        tableHtml([{ t: "Pool" }, { t: "Credits", num: 1 }, { t: "Brand limit", num: 1 }, { t: "Credits" }, { t: "Brands" }], fit) +
        `<p class="note">${r.smallest ? "On paper, the smallest listed pool that covers this plan is " + esc(r.smallest.label) + " (" + fmtInt(r.smallest.pool) + " credits). " : "No listed pool covers this plan on paper. "}This is arithmetic only, not a recommendation. Brand limits and credit amounts come from the Postonomous offer page; check them before deciding. ${DISCLAIMER}</p>`;
    },
    text: (r) => `Credit split — pool ${r.pool}, needed ${r.totalNeed}\n` + r.rows.map((b) => `${b.name}: needs ${b.need}, gets ${b.alloc}${b.short ? " (short " + b.short + ")" : ""}`).join("\n"),
    entry: (s, r) => ({ name: r.rows.length + " brands — " + fmtInt(r.totalNeed) + " credits", meta: "Pool " + fmtInt(r.pool) }),
    after: () => { document.getElementById("cms-custom-wrap").style.display = cmSplit.state.pool === "custom" ? "" : "none"; },
  });
}

/* ---------- CreditMap 3: Tracker ---------- */
function initCreditTracker() {
  const today = new Date(), dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  cmTrack = createTool({
    id: "cm_track", root: "sub-cm-track", defaults: { pool: 5000, days: dim, day: today.getDate(), log: [] },
    placeholder: "Set the pool and day, then add entries as you spend credits.",
    rowDefs: [{
      key: "log", el: "#cmt-rows", addBtn: "#cmt-add", newRow: () => ({ brand: planNames()[0], credits: "", note: "" }),
      cols: [{ k: "brand", label: "Brand", type: "select", w: 110, options: (r) => { const o = planNames(); if (r.brand && !o.includes(r.brand)) o.push(r.brand); return o.map((x) => [x, x]); } },
        { k: "credits", label: "Credits", type: "number", w: 70 }, { k: "note", label: "Note", type: "text", w: 110, ph: "optional" }],
    }],
    compute: (s) => computeTracker(s, cmSplit.result),
    render: (r) => {
      const call = r.overrun > 0
        ? `<div class="callout warn">At this pace you would use about <strong>${fmtInt(r.overrun)}</strong> credits more than the pool holds.</div>`
        : r.expiring > 0 ? `<div class="callout">At this pace about <strong>${fmtInt(r.expiring)}</strong> credits would expire unused at month end. Unused credits don't carry over.</div>`
        : `<div class="callout">At this pace you would use the whole pool.</div>`;
      const stBadge = (x) => x === "over" ? badge("Over pace", "bad") : x === "under" ? badge("Under pace", "mid") : badge("On pace", "good");
      const rows = r.rows.map((b) => ({ cells: [esc(b.name) + (b.unplanned ? " (not in plan)" : ""), fmtInt(b.planned), fmtInt(b.spent), fmtInt(b.expected), fmtInt(b.projected), stBadge(b.status), fmtInt(b.unused)] }));
      return `<div class="stat-row">${stat("Spent", fmtInt(r.spent))}${stat("Left", fmtInt(r.remaining))}${stat("Day", r.day + " of " + r.days)}${stat("Month-end pace", fmtInt(r.projected))}</div>` + call +
        tableHtml([{ t: "Brand" }, { t: "Plan", num: 1 }, { t: "Spent", num: 1 }, { t: "Expected by now", num: 1 }, { t: "Month-end", num: 1 }, { t: "Pace" }, { t: "Unused if pace holds", num: 1 }], rows) +
        `<p class="note">${r.hasPlan ? "Plan figures come from your Brand Split." : "No Brand Split yet, so the whole pool is treated as one plan."} ${DISCLAIMER}</p>`;
    },
    text: (r) => `Credit tracker — day ${r.day} of ${r.days}\nSpent ${r.spent} of ${r.pool}; month-end pace ${Math.round(r.projected)}; would expire ${Math.round(r.expiring)}\n` +
      r.rows.map((b) => `${b.name}: plan ${b.planned}, spent ${b.spent}, month-end ${Math.round(b.projected)}`).join("\n"),
    entry: (s, r) => ({ name: "Day " + r.day + " of " + r.days + " — " + fmtInt(r.spent) + " spent", meta: (s.log || []).length + " entries" }),
  });
  document.getElementById("cmt-usepool").addEventListener("click", () => {
    cmTrack.state.pool = splitPool(cmSplit.state); cmTrack.fill(); cmTrack.update(); showToast("Pool copied from Brand Split");
  });
}
function planNames() {
  const r = cmSplit && cmSplit.result;
  return r && r.rows.length ? r.rows.map((b) => b.name) : ["All brands"];
}

/* ---------- Retainer 1: Pricing Engine ---------- */
function initPricing() {
  rtPrice = createTool({
    id: "rt_price", root: "sub-rt-price",
    defaults: { type: "cafe", market: "mid", networks: 3, posts: 12, images: 8, shorts: 4, longCount: 1, longMin: 3, style: "wb", scoreAll: true, rate: 40, margin: 30, hours: "", tool: 287, amort: 12, pool: 5000, name: "" },
    placeholder: "Enter at least one post, short or long video to price a retainer.",
    compute: (s) => computePricing(s, getRates()),
    render: (r, s) => {
      const cards = r.tiers.map((t) => `<div class="tier-card${t.id === "better" ? " is-mid" : ""}"><h3>${esc(t.name)}</h3>
        <div class="price">${fmtMoney(t.price)} <small>/ month</small></div>
        <ul><li>${t.posts} posts × ${t.networks} network${t.networks > 1 ? "s" : ""}</li><li>${t.images} images, ${t.shorts} short videos</li><li>${t.longCount} long video${t.longCount === 1 ? "" : "s"}${t.longCount ? " (" + t.longMin + " min)" : ""}</li>
        <li>${fmtInt(t.credits)} credits, about ${fmt1(t.hours)} hours</li><li>Your cost about ${fmtMoney(t.cost)}; margin ${fmt1(t.marginPct)}%</li></ul></div>`).join("");
      const basis = (t) => t.basis === "floor" ? badge("cost floor", "mid") : t.basis === "step" ? badge("step up", "neutral") : badge("market", "good");
      return `<div class="tier-grid">${cards}</div>` +
        tableHtml([{ t: "Tier" }, { t: "Cost floor", num: 1 }, { t: "Market estimate", num: 1 }, { t: "Price", num: 1 }, { t: "Set by" }],
          r.tiers.map((t) => ({ cells: [esc(t.name), fmtMoney(t.floor), fmtMoney(t.market), fmtMoney(t.price), basis(t)] }))) +
        `<p class="note">Price is the higher of your cost-plus-margin floor and a market estimate for a ${esc((TYPE_LABEL[s.type] || "").toLowerCase())} in a ${s.market === "metro" ? "major metro" : s.market === "small" ? "small town" : "mid-size city"}, kept inside the $500–$5,000 range the Postonomous page quotes. Credit cost is your tool price spread over ${fmtInt(s.amort)} months and the credit pool. The market estimate is a planning guide, not a forecast. ${DISCLAIMER}</p>`;
    },
    text: (r, s) => `Retainer quote${s.name ? " — " + s.name : ""}\n` + r.tiers.map((t) => `${t.name}: ${fmtMoney(t.price)}/month — ${t.posts} posts × ${t.networks} networks, ${t.images} images, ${t.shorts} shorts, ${t.longCount} long video(s)`).join("\n"),
    entry: (s, r) => ({ name: (s.name || TYPE_LABEL[s.type]) + " — " + fmtMoney(r.tiers[1].price) + "/mo", meta: "Good " + fmtMoney(r.tiers[0].price) + " · Best " + fmtMoney(r.tiers[2].price) }),
  });
}

/* ---------- Retainer 2: Margin & Payback ---------- */
function initMargin() {
  rtMargin = createTool({
    id: "rt_margin", root: "sub-rt-margin",
    defaults: { price: 750, clients: 5, tool: 287, credits: 600, pool: 5000, hours: 8, rate: 40, overhead: 0, countTime: true },
    placeholder: "Enter a monthly price per client to see margin and payback.",
    compute: (s) => computeMargin(s),
    render: (r, s) => {
      const rec = (x) => x == null ? badge("never at this price", "bad") : x <= 1 ? "under 1 month" : fmt1(x) + " months";
      const rows = r.scenarios.map((c) => ({ cells: [c.clients + (c.clients === r.custom && ![1, 5, 10].includes(c.clients) ? " (yours)" : ""), fmtMoney(c.revenue), fmtMoney(c.time), fmtMoney(c.net), fmtMoney(c.perClient), rec(c.recoupMonths), fmtInt(c.creditsUsed) + (c.fits ? "" : " ⚠")] }));
      const k = r.claim;
      return `<div class="stat-row">${stat("Tool cost", fmtMoney(r.tool))}${stat("Price per client", fmtMoney(r.price))}${stat("Clients the pool covers", r.maxClients == null ? "—" : fmtInt(r.maxClients))}</div>` +
        tableHtml([{ t: "Clients", num: 1 }, { t: "Revenue", num: 1 }, { t: "Your time", num: 1 }, { t: "Net / month", num: 1 }, { t: "Net per client", num: 1 }, { t: "Tool paid back in" }, { t: "Credits used", num: 1 }], rows) +
        `<div class="sub-h">Claim check, using your numbers</div>
        <div class="callout"><strong>"One client covers the Bundle in the first month."</strong> At ${fmtMoney(r.price)} per month, one client brings in ${fmtMoney(k.oneRevenue)} against a ${fmtMoney(r.tool)} tool: ${k.oneCoversByRevenue ? "yes on revenue" : "no on revenue"}. After your time and other costs, one client nets ${fmtMoney(k.oneNet)}: ${k.oneCoversAfterCosts ? "that covers the tool in month one" : "that does not cover the tool in month one"}.</div>
        <div class="callout"><strong>"Ten clients."</strong> Ten clients at your price is ${fmtMoney(k.tenRevenue)} a month in revenue. ${r.scenarios.find((c) => c.clients === 10).fits ? "Your credit pool covers ten at " + fmtInt(s.credits) + " credits each." : "Ten clients at " + fmtInt(s.credits) + " credits each would need more credits than your pool holds."}</div>
        <p class="note">${DISCLAIMER}</p>`;
    },
    text: (r) => `Margin & payback — price ${fmtMoney(r.price)}, tool ${fmtMoney(r.tool)}\n` + r.scenarios.map((c) => `${c.clients} client(s): net ${fmtMoney(c.net)}/month, paid back in ${c.recoupMonths == null ? "never" : fmt1(c.recoupMonths) + " months"}`).join("\n"),
    entry: (s, r) => ({ name: fmtMoney(r.price) + " × " + r.custom + " clients", meta: "Tool " + fmtMoney(r.tool) }),
  });
  document.getElementById("rtm-use").addEventListener("click", () => {
    const t = rtPrice.result && rtPrice.result.tiers[1];
    if (!t) { showToast("Set up the Pricing Engine first"); return; }
    Object.assign(rtMargin.state, { price: t.price, credits: Math.round(t.credits), hours: round2(t.hours), rate: rtPrice.state.rate, tool: rtPrice.state.tool, pool: rtPrice.state.pool });
    rtMargin.fill(); rtMargin.update(); showToast("Filled from Pricing Engine");
  });
  document.querySelectorAll("[data-set-tool]").forEach((b) => b.addEventListener("click", () => {
    rtMargin.state.tool = Number(b.dataset.setTool); rtMargin.fill(); rtMargin.update();
  }));
}

/* ---------- Retainer 3: Audit One-Pager ---------- */
function initAudit() {
  rtAudit = createTool({
    id: "rt_audit", root: "sub-rt-audit",
    defaults: { agency: "", contact: "", prospect: "", s1: 62, s2: 48, s3: 71, s4: 55, s5: 41, weakLabel: "the weekend sale post", rewritten: 84, tier: "better", customPrice: "" },
    placeholder: "Enter the prospect's post scores to build the one-pager.",
    compute: (s) => computeAudit(s, rtPrice && rtPrice.result ? rtPrice.result.tiers : [], getCutoffs()),
    render: (r, s) => {
      const who = s.prospect.trim() || "your business", by = s.agency.trim();
      const when = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      const rows = r.scores.map((v, i) => `<tr><td>Post ${i + 1}</td><td class="num">${fmt1(v)}</td><td>${esc(r.verdicts[i])}</td></tr>`).join("");
      const weak = s.weakLabel.trim() || "the weakest post";
      const rewrite = r.rewritten != null ? `<p>We rewrote the weakest post (${esc(weak)}), which scored <strong>${fmt1(r.min)}</strong>. The new version scores <strong>${fmt1(r.rewritten)}</strong>, ${r.lift >= 0 ? "a change of +" + fmt1(r.lift) : "a change of " + fmt1(r.lift)} points.</p>` : "";
      let plan = "";
      if (r.price != null) {
        const d = r.tierDetail;
        plan = `<p><span class="pill">Suggested plan: ${fmtMoney(r.price)} per month.</span>${d ? " That covers " + d.posts + " posts across " + d.networks + " network" + (d.networks > 1 ? "s" : "") + ", " + d.images + " images, " + d.shorts + " short videos and " + d.longCount + " long video" + (d.longCount === 1 ? "" : "s") + " each month, every post scored before it goes out." : ""}</p>`;
      }
      return `<div class="audit-sheet print-area">
        <h2>Social content audit${s.prospect.trim() ? " — " + esc(s.prospect.trim()) : ""}</h2>
        <p class="sheet-sub">Prepared for ${esc(who)}${by ? " by " + esc(by) : ""} · ${esc(when)}</p>
        <p>We scored ${r.scores.length} recent post${r.scores.length === 1 ? "" : "s"} from ${esc(who)} on a 0–100 scale. The average is <span class="big">${fmt1(r.avg)}</span> <span class="fine">out of 100</span>.</p>
        <table><thead><tr><th>Post</th><th class="num">Score</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>
        <p>${r.belowBar} of ${r.scores.length} post${r.scores.length === 1 ? "" : "s"} fall${r.belowBar === 1 ? "s" : ""} below the ${fmt1(r.cut.promote)} we would want before putting ad money behind a post, and ${r.fixFirst} ${r.fixFirst === 1 ? "is" : "are"} below ${fmt1(r.cut.fix)}. The spread from best to worst is ${fmt1(r.spread)} points, which suggests results swing a lot from one post to the next.</p>
        ${rewrite}${plan}
        ${s.contact.trim() ? `<p class="fine">Contact: ${esc(s.contact.trim())}</p>` : ""}
        <p class="fine">Scores come from a simulator and are a signal, not a guarantee of results. Prices are estimates for discussion.</p></div>`;
    },
    text: (r, s) => `Social content audit${s.prospect ? " — " + s.prospect : ""}\nAverage score ${fmt1(r.avg)}/100 across ${r.scores.length} posts (best ${fmt1(r.max)}, weakest ${fmt1(r.min)}).\n` +
      `${r.belowBar} of ${r.scores.length} below ${fmt1(r.cut.promote)}; ${r.fixFirst} below ${fmt1(r.cut.fix)}.\n` +
      (r.rewritten != null ? `Weakest post rewritten: ${fmt1(r.min)} → ${fmt1(r.rewritten)}.\n` : "") + (r.price != null ? `Suggested plan: ${fmtMoney(r.price)} per month.\n` : "") + "Scores are a signal, not a guarantee.",
    entry: (s, r) => ({ name: (s.prospect.trim() || "Audit") + " — avg " + fmt1(r.avg), meta: r.scores.length + " posts" + (r.price != null ? " · " + fmtMoney(r.price) + "/mo" : "") }),
    after: () => { document.getElementById("rta-custom-wrap").style.display = rtAudit.state.tier === "custom" ? "" : "none"; },
  });
  document.getElementById("rta-print").addEventListener("click", () => { if (!rtAudit.result) { showToast("Nothing to print yet"); return; } window.print(); });
}

/* ---------- Proven 1: Budget Splitter ---------- */
function initBudgetSplitter() {
  pvSplit = createTool({
    id: "pv_split", root: "sub-pv-split",
    defaults: { budget: 500, reserve: 10, fix: 50, promote: 70, drafts: [{ label: "Draft A", score: 41 }, { label: "Draft B", score: 58 }, { label: "Draft C", score: 87 }] },
    placeholder: "Enter a budget and at least one draft score.",
    rowDefs: [{
      key: "drafts", el: "#pvs-rows", addBtn: "#pvs-add", newRow: (rows) => ({ label: "Draft " + String.fromCharCode(65 + rows.length % 26), score: "" }),
      cols: [{ k: "label", label: "Draft", type: "text", w: 130 }, { k: "score", label: "WinScore", type: "number", max: 100, w: 80 }],
    }],
    compute: (s) => computeBudgetSplit(s),
    render: (r) => {
      const tb = (d) => badge(TIER_LABEL[d.tier], d.tier === "promote" ? "good" : d.tier === "notyet" ? "mid" : "bad");
      const rows = r.drafts.map((d) => ({ cells: [esc(d.label), fmt1(d.score), tb(d), d.amount ? fmtMoney2(d.amount) : "—", d.amount ? fmt1(d.share) + "%" : "—", esc(d.action)] }));
      let call = "";
      if (!r.promoCount) call = `<div class="callout warn">No draft reaches ${fmt1(r.cut.promote)}, so ${fmtMoney2(r.heldPool)} is held back. Send the weaker drafts through Champion Mode, re-score them, and come back.</div>`;
      else call = `<div class="callout">${r.promoCount} draft${r.promoCount === 1 ? "" : "s"} clear${r.promoCount === 1 ? "s" : ""} the bar and ${r.promoCount === 1 ? "gets" : "share"} ${fmtMoney2(r.pool)}, with higher scores getting more.${r.heldReserve > 0 ? " The test reserve of " + fmtMoney2(r.heldReserve) + " is held because no draft sits in the \"Not yet\" band." : ""}</div>`;
      return `<div class="stat-row">${stat("Budget", fmtMoney2(r.budget))}${stat("Allocated", fmtMoney2(r.allocated))}${stat("Held back", fmtMoney2(r.held))}</div>` + call +
        tableHtml([{ t: "Draft" }, { t: "Score", num: 1 }, { t: "Verdict" }, { t: "Budget", num: 1 }, { t: "Share", num: 1 }, { t: "Next step" }], rows) +
        `<p class="note">Budget goes only to drafts at or above ${fmt1(r.cut.promote)}, weighted by how far each clears ${fmt1(r.cut.fix)} (squared). The test reserve (${fmtMoney2(r.reserve)}) goes to the best draft in the "Not yet" band. A WinScore is a signal, not a guarantee, and Postonomous does not run your ads. ${DISCLAIMER}</p>`;
    },
    text: (r) => `Budget split — ${fmtMoney2(r.budget)}\n` + r.drafts.map((d) => `${d.label} (${fmt1(d.score)}) ${TIER_LABEL[d.tier]}: ${d.amount ? fmtMoney2(d.amount) : "—"}`).join("\n") + (r.held > 0 ? `\nHeld back: ${fmtMoney2(r.held)}` : ""),
    entry: (s, r) => ({ name: fmtMoney(r.budget) + " across " + r.drafts.length + " drafts", meta: r.promoCount + " worth promoting" }),
    after: () => { lsSet("cutoffs", { fix: n(pvSplit.state.fix), promote: Math.max(n(pvSplit.state.promote), n(pvSplit.state.fix)) }); },
  });
  document.getElementById("pvs-send").addEventListener("click", () => {
    const r = pvSplit.result;
    if (!r) { showToast("Nothing to send yet"); return; }
    const picks = r.drafts.filter((d) => d.amount > 0);
    if (!picks.length) { showToast("No budget allocated to send"); return; }
    pvLedger.state.rows = pvLedger.state.rows || [];
    picks.forEach((d) => pvLedger.state.rows.push({ label: d.label, score: d.score, spend: d.amount, results: "" }));
    pvLedger.rows.rows.render(); pvLedger.update(); showToast("Sent to Boost Ledger");
  });
}

/* ---------- Proven 2: Calibration Log ---------- */
function initCalibration() {
  pvCal = createTool({
    id: "pv_cal", root: "sub-pv-cal", defaults: { metric: "Engagements", entries: [] },
    placeholder: "Add at least two published posts with a WinScore and an actual result.",
    rowDefs: [{
      key: "entries", el: "#pvc-rows", addBtn: "#pvc-add", newRow: (rows) => ({ label: "Post " + (rows.length + 1), score: "", result: "" }),
      cols: [{ k: "label", label: "Post", type: "text", w: 100 }, { k: "score", label: "WinScore", type: "number", max: 100, w: 70 }, { k: "result", label: "Actual result", type: "number", w: 90 }],
    }],
    compute: (s) => computeCalibration(s, getCutoffs()),
    render: (r, s) => {
      const tk = r.trust.key === "strong" ? "good" : r.trust.key === "moderate" ? "mid" : r.trust.key === "few" ? "neutral" : "bad";
      const metric = esc(s.metric || "result"), pct = (x) => (x == null ? "—" : Math.round(x * 100) + "%");
      const band = (key, label) => ({ cells: [esc(label), String(r.bands[key].count), r.bands[key].median == null ? "—" : fmt1(r.bands[key].median), pct(r.bands[key].hitRate)] });
      let sug;
      if (r.suggest) {
        sug = `<div class="callout">Your scores and results suggest a <strong>"Worth promoting" cutoff of ${r.suggest.promote}</strong> (${pct(r.suggest.promoteHit)} of the ${r.suggest.promoteCount} posts at or above it beat your median) and a <strong>"Fix it first" cutoff of ${r.suggest.fix}</strong>${r.suggest.fixFound ? " (" + pct(r.suggest.fixHit) + " of posts below it beat your median)" : " (kept at your current value; no cutoff separated weak posts cleanly)"}. Press <em>Apply suggested cutoffs</em> to use them in the Budget Splitter.</div>`;
      } else sug = `<div class="callout warn">You have ${r.count} post${r.count === 1 ? "" : "s"}. With ${MIN_CAL} or more, this tool suggests your own cutoffs.</div>`;
      return `<div class="stat-row">${stat("Posts logged", String(r.count))}${stat("Score ↔ " + (s.metric || "result"), r.r == null ? "—" : r.r.toFixed(2))}${stat("Median " + (s.metric || "result"), fmt1(r.median))}</div>` +
        `<p style="margin:0 0 12px">${badge(r.trust.label, tk)}</p>` + sug +
        tableHtml([{ t: "Score band" }, { t: "Posts", num: 1 }, { t: "Median " + (s.metric || "result"), num: 1 }, { t: "Beat overall median", num: 1 }],
          [band("promote", "Worth promoting (" + r.cut.promote + "+)"), band("notyet", "Not yet (" + r.cut.fix + "–" + (r.cut.promote - 1) + ")"), band("fix", "Fix it first (below " + r.cut.fix + ")")]) +
        `<p class="note">"Beat overall median" is the share of posts in the band whose ${metric} was above the median of all logged posts. Correlation runs from −1 to 1; closer to 1 means your scores tracked your results. A small log is noisy. ${DISCLAIMER}</p>`;
    },
    text: (r, s) => `Calibration — ${r.count} posts, ${s.metric || "result"}\nScore/result correlation: ${r.r == null ? "n/a" : r.r.toFixed(2)} (${r.trust.label})\n` +
      (r.suggest ? `Suggested cutoffs: fix below ${r.suggest.fix}, promote from ${r.suggest.promote}` : `Need ${MIN_CAL}+ posts for suggested cutoffs`),
    entry: (s, r) => ({ name: r.count + " posts — " + (r.r == null ? "r n/a" : "r " + r.r.toFixed(2)), meta: s.metric || "result" }),
  });
  document.getElementById("pvc-apply").addEventListener("click", () => {
    const r = pvCal.result;
    if (!r || !r.suggest) { showToast("Log " + MIN_CAL + "+ posts first"); return; }
    pvSplit.state.fix = r.suggest.fix; pvSplit.state.promote = r.suggest.promote;
    pvSplit.fill(); pvSplit.update(); refreshAll(); showToast("Cutoffs applied: " + r.suggest.fix + " / " + r.suggest.promote);
  });
}

/* ---------- Proven 3: Boost Ledger ---------- */
function initLedger() {
  pvLedger = createTool({
    id: "pv_ledger", root: "sub-pv-ledger", defaults: { metric: "Leads", rows: [] },
    placeholder: "Add a boosted post with its spend, or send a split from the Budget Splitter.",
    rowDefs: [{
      key: "rows", el: "#pvl-rows", addBtn: "#pvl-add", newRow: (rows) => ({ label: "Post " + (rows.length + 1), score: "", spend: "", results: "" }),
      cols: [{ k: "label", label: "Post", type: "text", w: 90 }, { k: "score", label: "WinScore", type: "number", max: 100, w: 64 }, { k: "spend", label: "Spend $", type: "number", step: "0.01", w: 70 }, { k: "results", label: "Results", type: "number", w: 64 }],
    }],
    compute: (s) => computeLedger(s, getCutoffs(), pvCal && pvCal.result),
    render: (r, s) => {
      const m = esc(s.metric || "result"), cpr = (x) => (x == null ? "—" : fmtMoney2(x));
      const order = ["promote", "notyet", "fix", "unscored"].filter((t) => r.tiers[t].posts > 0);
      const rows = order.map((t) => ({ cells: [esc(TIER_LABEL[t]), String(r.tiers[t].posts), fmtMoney2(r.tiers[t].spend), fmtInt(r.tiers[t].results), cpr(r.tiers[t].cpr)] }));
      let v = "";
      if (r.versus) {
        v = `<div class="callout">Posts scored ${r.cut.promote}+ cost <strong>${fmtMoney2(r.versus.promoteCpr)}</strong> per ${m}; the rest cost <strong>${fmtMoney2(r.versus.restCpr)}</strong>. ${r.versus.ratio >= 1 ? "Higher-scored posts were " + fmt1(r.versus.ratio) + "× cheaper per result in this ledger." : "In this ledger, higher-scored posts were not cheaper per result."}</div>`;
      } else v = `<div class="callout warn">Add results for both high-scored posts and the rest to compare cost per ${m}.</div>`;
      let c = "";
      if (r.calCompare) {
        const cc = r.calCompare;
        c = `<div class="callout">Your Calibration Log suggests a cutoff of <strong>${cc.cutoff}</strong>. In this ledger, posts at or above it cost ${cpr(cc.hi.cpr)} per ${m} and posts below it cost ${cpr(cc.lo.cpr)}.</div>`;
      }
      return `<div class="stat-row">${stat("Total spend", fmtMoney2(r.overall.spend))}${stat("Results counted", fmtInt(r.overall.results))}${stat("Cost per " + (s.metric || "result"), cpr(r.overall.cpr))}</div>` + v + c +
        tableHtml([{ t: "Score tier" }, { t: "Posts", num: 1 }, { t: "Spend", num: 1 }, { t: "Results", num: 1 }, { t: "Cost per " + (s.metric || "result"), num: 1 }], rows) +
        `<p class="note">Cost per result uses only posts where you entered results. Tiers use the cutoffs in your Budget Splitter (${r.cut.fix} / ${r.cut.promote}). Small samples are noisy. ${DISCLAIMER}</p>`;
    },
    text: (r, s) => `Boost ledger — spend ${fmtMoney2(r.overall.spend)}, ${fmtInt(r.overall.results)} ${s.metric || "results"}, cost per result ${r.overall.cpr == null ? "n/a" : fmtMoney2(r.overall.cpr)}\n` +
      r.rows.map((x) => `${x.label} (${x.score == null ? "no score" : fmt1(x.score)}): ${fmtMoney2(x.spend)} → ${x.results == null ? "pending" : x.results}`).join("\n"),
    entry: (s, r) => ({ name: r.rows.length + " posts — " + fmtMoney(r.overall.spend) + " spent", meta: s.metric || "results" }),
  });
}

/* =====================================================================
   Gate, theme, tabs
   ===================================================================== */
async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function initGate() {
  const gate = document.getElementById("gate"), form = document.getElementById("gateForm");
  const input = document.getElementById("gatePassword"), error = document.getElementById("gateError");
  if (gate.classList.contains("is-unlocked")) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hash = await sha256Hex(input.value.trim());
    if (hash === GATE_HASH) {
      try { localStorage.setItem("payback_access", "granted"); } catch (err) {}
      gate.classList.add("is-unlocked");
      error.classList.remove("is-visible");
    } else {
      error.classList.add("is-visible");
      input.value = ""; input.focus();
    }
  });
}
function initTheme() {
  const toggle = document.getElementById("themeToggle"), root = document.documentElement;
  function effectiveTheme() {
    const attr = root.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  toggle.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("payback_theme", next); } catch (e) {}
  });
}
function initTabs() {
  const btns = document.querySelectorAll(".tab-btn");
  btns.forEach((btn) => btn.addEventListener("click", () => {
    btns.forEach((b) => { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
    btn.classList.add("is-active"); btn.setAttribute("aria-selected", "true");
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
    document.getElementById("panel-" + btn.dataset.tab).classList.add("is-active");
    refreshAll();
  }));
  document.querySelectorAll(".subtabs").forEach((bar) => {
    const panel = bar.closest(".panel");
    bar.querySelectorAll(".sub-btn").forEach((btn) => btn.addEventListener("click", () => {
      bar.querySelectorAll(".sub-btn").forEach((b) => { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("is-active"); btn.setAttribute("aria-selected", "true");
      panel.querySelectorAll(".subpanel").forEach((p) => p.classList.remove("is-active"));
      document.getElementById("sub-" + btn.dataset.sub).classList.add("is-active");
      refreshAll();
    }));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initGate();
  initTheme();
  initTabs();
  // order matters: tools that others read from are created first
  initCreditSplit();
  initCreditBuilder();
  initCreditTracker();
  initBudgetSplitter();
  initCalibration();
  initLedger();
  initPricing();
  initMargin();
  initAudit();
  refreshAll();
});
