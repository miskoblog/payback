/**
 * Demo video screen-recording template — Playwright, per-segment isolated.
 *
 * COPY THIS FILE and adapt BASE_URL/GATE_PASSWORD/unlockPage and the BEATS
 * array to the actual app's shot list from SKILL.md Phase 2. This is the
 * fully verified architecture from the last build of this skill — every
 * design choice below was arrived at by fixing a real, observed defect, not
 * speculatively. Read the comments before changing the structure.
 *
 * ARCHITECTURE — EACH NARRATION SEGMENT IS RECORDED IN ITS OWN FRESH BROWSER
 * CONTEXT, not cut out of one long continuous recording, and not even one
 * context per beat. Split every beat's approved narration into clause-level
 * segments, each paired 1:1 with the specific on-screen action it describes.
 * This was a hard-learned fix: headless Chromium's screencast-based video
 * recorder is not guaranteed real-time, and under sustained DOM churn (many
 * clicks, dropdown open/close, repeated style updates) it measurably falls
 * behind wall-clock — verified by extracting exact frame numbers and
 * comparing against Date.now()-logged timestamps; the drift compounded to
 * 1-2+ seconds by the middle of a 9-segment beat. A single continuous
 * recording cut by timestamp cannot be trusted to stay in sync with its
 * voiceover. Recording each segment as its own short, fresh context
 * sidesteps the problem entirely (frame 0 = context creation, negligible lag
 * over just a few seconds) at the cost of more browser churn — worth it.
 *
 * Because each segment starts from a fresh page load, any segment whose
 * action leaves persistent state on screen (a checked box, a filled field, a
 * generated output) declares a `replay` function — a fast, unanimated
 * re-application of that same state, run silently at the start of every
 * later segment in the same beat so accumulated progress is still visible,
 * before that segment's own animated action begins.
 *
 * CONTINUITY BETWEEN SEGMENTS — every segment's fresh page resets scroll
 * position and cursor position by default, which (if left alone) reads as a
 * jarring jump-cut every time segments are concatenated: the page snapping
 * to a different scroll spot, the cursor popping back to its start position.
 * The runner below carries `lastScrollY`/`lastCursorPos` forward and
 * silently restores them (instant, no animation) right after setup/replay,
 * before the segment's own visible action starts.
 *
 * INVISIBLE-BUT-ACTUALLY-VISIBLE PREFIX — recordVideo captures from context
 * creation onward, so setup + replay steps are NOT actually invisible,
 * they're just fast; with several chained replay steps (each carrying
 * Playwright's own actionability waits) that "fast" can still be a real
 * 1-3s of visible navigation/clicking on camera before the segment's own
 * action even starts. The runner marks `visibleStart` (elapsed time at the
 * point the segment's own action begins) and writes it to that segment's
 * clicks.json; assembly MUST trim everything before that timestamp out of
 * the segment's video (see the skill's ffmpeg cookbook / assemble script) or
 * every segment will have a dead, replayed prefix baked into the final cut.
 *
 * CURSOR — plain arrow, 40x46px box (NOT 40x54 — that height stretches the
 * arrow's proportions into an "outstretched" look; 46 is the tallest that
 * still reads as a normal OS cursor), anchored at the tip like a native
 * pointer. `preserveAspectRatio="none"` on the SVG is REQUIRED — without it
 * the browser letterboxes the square 24x24 viewBox inside this non-square
 * box instead of stretching it, silently adding unaccounted offset. The
 * CURSOR_TIP_OFFSET_X/Y constants below (2, 0) were measured empirically —
 * render the cursor alone to a screenshot, scan pixel-by-pixel for the first
 * non-background pixel from the anchor point — NOT derived from viewBox
 * math, which proved unreliable both times this was tried. If you change the
 * SVG's viewBox/path or the box's width/height, re-measure these two
 * constants the same way (see "Re-measuring cursor tip offset" below) rather
 * than guessing new values.
 *
 * CLICK RING — an expanding colored ring fires on every real mousedown,
 * fired at (clickX + CURSOR_TIP_OFFSET_X, clickY + CURSOR_TIP_OFFSET_Y) so
 * it's centered exactly on the cursor's visual tip, not the div's anchor
 * corner. It's appended to the DOM BEFORE the cursor div, in addition to a
 * lower z-index — two independent guarantees the cursor paints in front of
 * the ring, not behind it (a real defect that shipped once: the ring was
 * technically correctly positioned but rendered on top, hiding the cursor
 * tip inside it). Pair this with a short synthesized click sound mixed in at
 * the same timestamp during assembly (see ffmpeg-cookbook.md) — it's the
 * click sound + ring + cursor-scale-down-on-press together that reads as a
 * real, deliberate click instead of the cursor just silently teleporting.
 *
 * initCursor() MUST BE THE LAST CALL IN setup() — this is an ordering
 * requirement, not a style preference, and it is a whole bug class rather than
 * a one-off. initCursor attaches the mousedown listener that fires the
 * click-ring animation. Any state-priming you do AFTER it (primeBrief,
 * primeShip, real page.click/fill/check calls) therefore fires a full visible
 * ring-pop per call, even though those clicks are supposed to be invisible.
 * Because priming runs immediately before `visibleStart` is marked, a
 * still-fading ring bleeds into the first frames of the trimmed on-camera
 * footage — which a client reported as the ring "blinking constantly," and it
 * took a real debugging round to trace back here. So: prime all state first,
 * inject the cursor last, and resist the urge to move initCursor() up to the
 * top of a new beat's setup() because it reads more naturally there.
 *
 * setup() MUST NOT SWITCH THE APP'S TABS — priming is only for restoring state
 * a real user would already have at that point (filled fields, checked boxes,
 * a generated result). Moving between the app's own top-level views is
 * narrative: it belongs to the beat's FIRST segment as a normal animated
 * clickAnimated on the nav button, with a matching `replay` so later segments
 * in the same beat still land on the right tab. Priming the tab switch in
 * setup() instead makes the beat open already on the new tab and the viewer
 * never sees the cursor go there — the single most-reported defect on the last
 * real build.
 *
 * EVERY VISIBLE CLICK IS AN ANIMATED CLICK — inside a segment's `action`, use
 * clickAnimated/typeAnimated/selectAnimated only; never a bare page.click(),
 * page.check() or page.fill(). A state change with no cursor on it reads as an
 * edit rather than a demo. `setup` and `replay` are the exceptions and the
 * exceptions are structural, not stylistic: both run before the segment's
 * `visibleStart`, which assembly trims out of the cut, so plain instant
 * Playwright calls are correct there (and __suppressEffects stops the ring
 * from firing while replays run). Tab/top-menu switches in particular must be
 * their own animated segment — that click is how the video signals it's moving
 * from one feature to the next.
 *
 * CENTER-START CURSOR — every beat with a cursor silently jumps it to
 * screen-center right after injecting it (before the first real glide, for
 * the beat's first segment only), so it never visibly travels in from
 * Playwright's default top-left corner. Starting from a screen corner reads
 * as an obvious recording artifact; starting from center reads as "the
 * cursor was already there."
 *
 * DROPDOWNS — native <select> popups aren't reliably captured by Chromium's
 * headless recordVideo. A styled overlay list (white rows, selected item
 * highlighted solid) is rendered and held on screen for ~550ms BEFORE the
 * cursor glides down and "clicks" the target option — showing the available
 * choices, not just snapping straight to the answer, matters for a demo
 * video (a viewer should see there were other options to pick from).
 *
 * SMOOTH SCROLLING — every scroll uses `element.scrollIntoView({behavior:
 * "smooth"})` / `window.scrollTo({..., behavior: "smooth"})`, never an
 * instant snap. Instant scrolling was the single biggest thing that made an
 * earlier cut of this kind of video read as a series of jump-cuts instead of
 * a real screen recording — smooth scrolling is not optional polish here,
 * it's required for the footage to look like genuine screen capture.
 *
 * SETUP: uses the Playwright already installed for this environment — do NOT
 * run `npm install playwright` or `playwright install`, both are unnecessary
 * and can conflict with the pinned browser build (require it from
 * `/opt/node22/lib/node_modules/playwright` as below, or set
 * `NODE_PATH=/opt/node22/lib/node_modules` and a bare `require("playwright")`
 * if running a standalone script outside this file, e.g. for tip-offset
 * measurement). Requires the app to be reachable — see SKILL.md Phase 0 on
 * why this should be a locally-served copy, not the live URL, even once the
 * live domain is allowlisted.
 *
 * RUN: node record_demo.js [ONLY_BEATS=01-x,02-y env var to filter, for
 *      re-recording a single beat during iteration without redoing everything]
 * OUTPUT: recordings/<beat-name>/manifest.json (segment texts, in order)
 *         recordings/<beat-name>/segNN/*.webm + clicks.json
 *           ({visibleStart, clicks: [seconds from segment start, ...]})
 */

const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "http://localhost:8420/"; // REPLACE — the app's local-mirror URL, see Phase 0
const GATE_PASSWORD = process.env.GATE_PASSWORD; // runtime only, never written to a file
if (!GATE_PASSWORD) { console.error("GATE_PASSWORD not set"); process.exit(1); }
const OUTPUT_DIR = path.join(__dirname, "..", "recordings");
const VIEWPORT = { width: 1920, height: 1080 };
const TYPE_DELAY = 55; // ms between keystrokes, so typing is visible on screen

// Tip vertex placed at (1,1) — right in the viewBox's corner (1 unit of
// margin, just enough for the stroke to render without clipping) — so the
// div's anchor point (= the real click coordinate) sits almost exactly where
// the arrow visually points, matching a real OS cursor's hotspot.
const CURSOR_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" preserveAspectRatio="none">' +
      '<path d="M1 1 L1 19 L6 14.2 L9.4 20.6 L12.1 19.2 L8.6 13 L15 13 Z" fill="#000" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>' +
      "</svg>"
  );

const PAGE_INIT = `
(() => {
  if (window.__cursorInit) return;
  window.__cursorInit = true;
  const style = document.createElement('style');
  style.textContent = \`
    #__fake-cursor {
      position: fixed; top: -100px; left: -100px; width: 40px; height: 46px;
      background: url('${CURSOR_SVG}') no-repeat center / 100% 100%;
      pointer-events: none; z-index: 2147483647;
      transition: transform 110ms ease-out;
    }
    #__fake-cursor.__pressed { transform: scale(0.5); }
    #__click-ring {
      position: fixed; width: 16px; height: 16px; margin-left: -8px; margin-top: -8px;
      border-radius: 50%; border: 3px solid #4636E3;
      background: rgba(70, 54, 227, 0.16);
      pointer-events: none; z-index: 2147483646;
      opacity: 0; transform: scale(0.4);
    }
    #__click-ring.__firing {
      animation: __ring-pop 420ms cubic-bezier(.2,.8,.2,1) forwards;
    }
    @keyframes __ring-pop {
      0%   { opacity: 0.9; transform: scale(0.4); }
      60%  { opacity: 0.7; }
      100% { opacity: 0; transform: scale(2.6); }
    }
    #__fake-dropdown {
      position: fixed; background: #fff; border: 1px solid #d9d9e3;
      border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18);
      z-index: 2147483646; overflow: hidden;
    }
    #__fake-dropdown .__opt { padding: 9px 12px; }
  \`;
  document.head.appendChild(style);
  // Ring appended BEFORE the cursor, in addition to its lower z-index — two
  // independent guarantees the cursor paints on top, not one relying on
  // z-index alone (see file header — this was a real shipped defect once).
  const ring = document.createElement('div');
  ring.id = '__click-ring';
  document.body.appendChild(ring);
  const cur = document.createElement('div');
  cur.id = '__fake-cursor';
  document.body.appendChild(cur);
  document.addEventListener('mousemove', (e) => {
    cur.style.left = e.clientX + 'px';
    cur.style.top = e.clientY + 'px';
  }, true);
  // Empirically measured (see file header + "Re-measuring cursor tip offset"
  // below) — do not replace with viewBox-derived math, it doesn't hold up.
  const CURSOR_TIP_OFFSET_X = 2;
  const CURSOR_TIP_OFFSET_Y = 0;
  window.__fireRing = (x, y) => {
    ring.style.left = x + CURSOR_TIP_OFFSET_X + 'px';
    ring.style.top = y + CURSOR_TIP_OFFSET_Y + 'px';
    ring.classList.remove('__firing');
    void ring.offsetWidth; // restart the CSS animation
    ring.classList.add('__firing');
  };
  window.__suppressEffects = false; // set true while silently replaying prior segments' state
  document.addEventListener('mousedown', (e) => {
    cur.classList.add('__pressed');
    if (!window.__suppressEffects) window.__fireRing(e.clientX, e.clientY);
  }, true);
  document.addEventListener('mouseup', () => cur.classList.remove('__pressed'), true);

  window.__openDropdown = (selector) => {
    const select = document.querySelector(selector);
    const rect = select.getBoundingClientRect();
    const cs = getComputedStyle(select);
    const list = document.createElement('div');
    list.id = '__fake-dropdown';
    list.style.left = rect.left + 'px';
    list.style.top = (rect.bottom + 3) + 'px';
    list.style.width = rect.width + 'px';
    list.style.font = cs.font;
    Array.from(select.options).forEach((opt) => {
      const row = document.createElement('div');
      row.className = '__opt';
      row.textContent = opt.textContent;
      row.dataset.value = opt.value;
      const selected = opt.value === select.value;
      row.style.background = selected ? '#4636E3' : '#fff';
      row.style.color = selected ? '#fff' : '#16161d';
      list.appendChild(row);
    });
    document.body.appendChild(list);
  };
  window.__highlightDropdownOption = (value) => {
    const list = document.getElementById('__fake-dropdown');
    if (!list) return null;
    let targetRect = null;
    Array.from(list.children).forEach((row) => {
      const match = row.dataset.value === value;
      row.style.background = match ? '#4636E3' : '#fff';
      row.style.color = match ? '#fff' : '#16161d';
      if (match) targetRect = row.getBoundingClientRect();
    });
    if (!targetRect) return null;
    return { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 };
  };
  window.__closeDropdown = () => {
    const list = document.getElementById('__fake-dropdown');
    if (list) list.remove();
  };
})();
`;

async function initCursor(page) {
  await page.evaluate(PAGE_INIT);
}

// Jump the (invisible-until-first-event) cursor to screen center in one
// instant, unanimated move — so the first *visible* glide starts from the
// middle of the screen, never from the top-left corner where Playwright's
// virtual mouse begins by default. Call only for a beat's first segment.
async function centerCursor(page) {
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
}

// Smoothly pans to an element only if it's actually out of view (a no-op
// otherwise) — see file header on why this must never be an instant snap.
async function smoothScrollIntoView(page, selector, index) {
  const scrolled = await page.evaluate(
    ([sel, idx]) => {
      const el = idx == null ? document.querySelector(sel) : document.querySelectorAll(sel)[idx];
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const inView = r.top >= 0 && r.bottom <= window.innerHeight;
      if (!inView) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return !inView;
    },
    [selector, index === undefined ? null : index]
  );
  if (scrolled) await page.waitForTimeout(650); // let the smooth scroll finish before acting
}

async function smoothScrollToTop(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(650);
}

async function moveTo(page, selector) {
  const loc = page.locator(selector);
  await smoothScrollIntoView(page, selector);
  const box = await loc.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 25 }); // steps = the visible glide, not a teleport
  await page.waitForTimeout(150);
  return { x, y };
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function logClick(ctx) {
  ctx.clicks.push(round((Date.now() - ctx.beatStart) / 1000));
}

// Post-click settle time is deliberately generous — the app's own CSS
// transitions (checkbox fill, tab pill color, etc) need to fully finish and
// be captured on screen before this segment's context closes.
const CLICK_SETTLE_MS = 350;

async function clickAnimated(page, selector, ctx) {
  await moveTo(page, selector);
  await page.mouse.down();
  await page.waitForTimeout(110);
  await page.mouse.up();
  logClick(ctx);
  await page.waitForTimeout(CLICK_SETTLE_MS);
}

async function typeAnimated(page, selector, text, ctx) {
  await moveTo(page, selector);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  logClick(ctx); // the focus click also gets a tick sound
  await page.waitForTimeout(250);
  await page.type(selector, text, { delay: TYPE_DELAY });
}

// Shows the rendered dropdown list, holds it open (~550ms) so the available
// options are actually visible on screen, THEN glides the cursor down onto
// the target option and clicks it, then applies the real value and closes
// the overlay. Do not skip the hold — clicking straight through defeats the
// point of rendering the dropdown at all.
async function selectAnimated(page, selector, value, ctx) {
  await moveTo(page, selector);
  await page.mouse.down();
  await page.waitForTimeout(110);
  await page.mouse.up();
  logClick(ctx);
  await page.evaluate((sel) => window.__openDropdown(sel), selector);
  await page.waitForTimeout(550); // dropdown visibly open before anything is picked
  const optPos = await page.evaluate((val) => window.__highlightDropdownOption(val), value);
  if (optPos) {
    await page.mouse.move(optPos.x, optPos.y, { steps: 12 });
    await page.waitForTimeout(250);
  }
  await page.mouse.down();
  await page.waitForTimeout(110);
  await page.mouse.up();
  logClick(ctx);
  await page.evaluate(() => window.__closeDropdown());
  await page.selectOption(selector, value);
  await page.waitForTimeout(CLICK_SETTLE_MS);
}

async function scrollToAnimated(page, selector, ms) {
  await smoothScrollIntoView(page, selector);
  await page.waitForTimeout(ms || 300);
}

async function hold(page, ms) {
  await page.waitForTimeout(ms);
}


// fill a numeric/text field with the cursor visibly clicking in, clearing, and typing
async function fillAnimated(page, selector, text, ctx) {
  await moveTo(page, selector);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  logClick(ctx);
  await page.waitForTimeout(200);
  await page.fill(selector, "");
  await page.type(selector, String(text), { delay: TYPE_DELAY });
  await page.waitForTimeout(250);
}

async function unlockPage(page, extra) {
  await page.goto(BASE_URL);
  await page.evaluate((x) => {
    localStorage.setItem("payback_access", "granted");
    localStorage.setItem("payback_theme", "light");
    Object.entries(x || {}).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  }, extra || null);
  await page.reload();
  await page.waitForSelector("#gate.is-unlocked", { state: "attached" });
}

const tab = (t) => `.tab-btn[data-tab="${t}"]`;
const sub = (s) => `.sub-btn[data-sub="${s}"]`;
// silent (setup/replay-only) navigation helpers
const goTab = async (page, t) => page.click(tab(t));
const goSub = async (page, s) => page.click(sub(s));

// Eight previously logged posts, so the Calibration Log has enough history to
// compute cutoffs. A real user would already have this log by the time they open it.
const CAL_PRIME = {
  "payback_state_pv_cal": {
    metric: "Engagements",
    entries: [
      { label: "Post 1", score: 44, result: 18 }, { label: "Post 2", score: 52, result: 25 },
      { label: "Post 3", score: 61, result: 40 }, { label: "Post 4", score: 68, result: 52 },
      { label: "Post 5", score: 73, result: 88 }, { label: "Post 6", score: 79, result: 95 },
      { label: "Post 7", score: 85, result: 140 }, { label: "Post 8", score: 38, result: 12 },
    ],
  },
};

const BEATS = [
  {
    name: "02-unlock",
    cursor: true,
    setup: async (page) => {
      await page.goto(BASE_URL);
      await page.waitForSelector("#gatePassword");
      await initCursor(page);
    },
    segments: [
      {
        text: "This is Payback, a free bonus for Postonomous buyers.",
        action: async (page) => hold(page, 400),
      },
      {
        text: "It sits behind a simple password gate, and this is the whole access flow: type the password you're given,",
        action: async (page, ctx) => typeAnimated(page, "#gatePassword", GATE_PASSWORD, ctx),
        replay: async (page) => page.fill("#gatePassword", GATE_PASSWORD),
      },
      {
        text: "and click unlock.",
        action: async (page, ctx) => {
          await clickAnimated(page, "#gateForm button[type=submit]", ctx);
          await page.waitForSelector("#gate.is-unlocked", { state: "attached" });
          await hold(page, 600);
        },
        replay: async (page) => {
          await page.click("#gateForm button[type=submit]");
          await page.waitForSelector("#gate.is-unlocked", { state: "attached" });
        },
      },
      {
        text: "Inside, Payback is three modules that follow one thread: credits, to price, to proof. Everything runs in your browser. No accounts, no API keys, nothing to connect.",
        action: async (page) => hold(page, 600),
      },
    ],
  },
  {
    name: "03-creditmap",
    cursor: true,
    setup: async (page) => { await unlockPage(page); await initCursor(page); },
    segments: [
      {
        text: "Start with CreditMap, where the question is: where does every credit go before the month starts?",
        action: async (page, ctx) => clickAnimated(page, tab("creditmap"), ctx),
        replay: async (page) => goTab(page, "creditmap"),
      },
      {
        text: "Postonomous tells you credits don't carry over, but it can only show you the price of each action. CreditMap turns that into a plan for the month.",
        action: async (page) => hold(page, 800),
      },
      {
        text: "In the Credit Budget Builder, set what one brand gets each month. Here's the sales page's own business: sixty posts, eight images, twenty-five scored posts, and it lands at 990 credits. The rates come straight from the sales page and you can edit every one.",
        action: async (page, ctx) => {
          await clickAnimated(page, "#cmb-preset", ctx);
          await hold(page, 900);
          await clickAnimated(page, ".rate-card summary", ctx);
          await hold(page, 1400);
          await clickAnimated(page, ".rate-card summary", ctx);
          await smoothScrollToTop(page);
        },
        replay: async (page) => page.click("#cmb-preset"),
      },
      {
        text: "Use your own AI key for text? Tick the box and those lines drop to zero. So you see your real number, not a generic one.",
        action: async (page, ctx) => {
          await clickAnimated(page, '[data-k="byo"]', ctx);
          await hold(page, 800);
        },
        replay: async (page) => page.check('[data-k="byo"]'),
      },
      {
        text: "Brand Split splits your pool across clients and shows who comes up short, with the arithmetic against each plan size. It shows the math; it doesn't tell you what to buy.",
        action: async (page, ctx) => {
          await clickAnimated(page, sub("cm-split"), ctx);
          await hold(page, 800);
          await scrollToAnimated(page, "#sub-cm-split .sub-h", 1200);
        },
        replay: async (page) => goSub(page, "cm-split"),
      },
      {
        text: "And the Tracker logs what you spend, projects where you'll finish, and flags credits that would expire unused.",
        action: async (page, ctx) => {
          await smoothScrollToTop(page);
          await clickAnimated(page, sub("cm-track"), ctx);
          await clickAnimated(page, "#cmt-usepool", ctx);
          await clickAnimated(page, "#cmt-add", ctx);
          await fillAnimated(page, '#cmt-rows input[data-i="0"][data-c="credits"]', "400", ctx);
          await hold(page, 800);
        },
      },
    ],
  },
  {
    name: "04-retainer",
    cursor: true,
    setup: async (page) => {
      await unlockPage(page);
      await goTab(page, "creditmap"); // restore where the previous beat ended
      await goSub(page, "cm-track");
      await initCursor(page);
    },
    segments: [
      {
        text: "Next, Retainer: what do I charge?",
        action: async (page, ctx) => clickAnimated(page, tab("retainer"), ctx),
        replay: async (page) => goTab(page, "retainer"),
      },
      {
        text: "The sales page gives you a $500 to $5,000 band and no way to place yourself inside it. Retainer does that, with your own credit cost and your own time.",
        action: async (page) => hold(page, 800),
      },
      {
        text: "In the Pricing Engine, pick a business type, market size, networks, posts and video load. You get a Good, Better and Best monthly price, with a floor built from your credit cost and your own time.",
        action: async (page, ctx) => {
          await selectAnimated(page, "#rtp-type", "dentist", ctx);
          await selectAnimated(page, "#rtp-market", "metro", ctx);
          await fillAnimated(page, "#rtp-posts", "16", ctx);
          await scrollToAnimated(page, "#sub-rt-price [data-out]", 900);
        },
        replay: async (page) => {
          await page.selectOption("#rtp-type", "dentist");
          await page.selectOption("#rtp-market", "metro");
          await page.fill("#rtp-posts", "16");
        },
      },
      {
        text: "That's a quote you can say out loud on Monday, not a guess.",
        action: async (page) => hold(page, 1200),
      },
      {
        text: "The Margin Calculator takes that price and shows profit per client, how many months to recoup your Postonomous purchase, and the one-, five- and ten-client picture, with your numbers.",
        action: async (page, ctx) => {
          await smoothScrollToTop(page);
          await clickAnimated(page, sub("rt-margin"), ctx);
          await clickAnimated(page, "#rtm-use", ctx);
          await scrollToAnimated(page, "#sub-rt-margin [data-out]", 1500);
        },
        replay: async (page) => { await goSub(page, "rt-margin"); await page.click("#rtm-use"); },
      },
      {
        text: "The Audit One-Pager turns five post scores and one rewrite into a printable findings page for a prospect, with your price on it.",
        action: async (page, ctx) => {
          await smoothScrollToTop(page);
          await clickAnimated(page, sub("rt-audit"), ctx);
          await fillAnimated(page, "#rta-agency", "Northside Social", ctx);
          await fillAnimated(page, "#rta-prospect", "Bright Smiles Dental", ctx);
          await scrollToAnimated(page, "#sub-rt-audit [data-out]", 1500);
        },
      },
    ],
  },
  {
    name: "05-proven",
    cursor: true,
    setup: async (page) => {
      await unlockPage(page, CAL_PRIME);
      await goTab(page, "retainer");
      await goSub(page, "rt-audit");
      await initCursor(page);
    },
    segments: [
      {
        text: "Last is Proven: where does the ad money go, and did it pay off?",
        action: async (page, ctx) => clickAnimated(page, tab("proven"), ctx),
        replay: async (page) => goTab(page, "proven"),
      },
      {
        text: "A WinScore is a strong signal, not a guarantee. Proven helps you act on the signal, then check it against what actually happened.",
        action: async (page) => hold(page, 800),
      },
      {
        text: "Give the Budget Splitter your drafts with their scores and a total budget. It holds back a test slice, gives nothing to drafts that need fixing first, and puts the rest behind the posts that clear the bar by the most.",
        action: async (page, ctx) => {
          await fillAnimated(page, "#pvs-budget", "600", ctx);
          await scrollToAnimated(page, "#sub-pv-split [data-out]", 1500);
        },
        replay: async (page) => page.fill("#pvs-budget", "600"),
      },
      {
        text: "So the money follows the score, with the arithmetic in plain sight, and one click sends the split to your ledger.",
        action: async (page, ctx) => {
          await clickAnimated(page, "#pvs-send", ctx);
          await hold(page, 900);
        },
        replay: async (page) => page.click("#pvs-send"),
      },
      {
        text: "The Calibration Log records each score beside what the post really did, then tells you how well scores track results in your niche, and suggests your own cutoffs.",
        action: async (page, ctx) => {
          await smoothScrollToTop(page);
          await clickAnimated(page, sub("pv-cal"), ctx);
          await clickAnimated(page, "#pvc-add", ctx);
          await fillAnimated(page, '#pvc-rows input[data-i="8"][data-c="score"]', "82", ctx);
          await fillAnimated(page, '#pvc-rows input[data-i="8"][data-c="result"]', "120", ctx);
          await scrollToAnimated(page, "#sub-pv-cal [data-out]", 1200);
          await clickAnimated(page, "#pvc-apply", ctx);
          await hold(page, 700);
        },
        replay: async (page) => {
          await goSub(page, "pv-cal");
          await page.click("#pvc-add");
          await page.fill('#pvc-rows input[data-i="8"][data-c="score"]', "82");
          await page.fill('#pvc-rows input[data-i="8"][data-c="result"]', "120");
          await page.click("#pvc-apply");
        },
      },
      {
        text: "And the Boost Ledger tracks spend and results per boosted post, so you can see whether higher scores were cheaper to promote.",
        action: async (page, ctx) => {
          await smoothScrollToTop(page);
          await clickAnimated(page, sub("pv-ledger"), ctx);
          await fillAnimated(page, '#pvl-rows input[data-i="0"][data-c="results"]', "12", ctx);
          await scrollToAnimated(page, "#sub-pv-ledger [data-out]", 1200);
        },
      },
    ],
  },
  {
    name: "06-fit",
    cursor: true,
    setup: async (page) => {
      await unlockPage(page);
      await goTab(page, "proven");
      await initCursor(page);
    },
    segments: [
      {
        text: "Payback doesn't replace anything in Postonomous. It picks up where the page leaves off:",
        action: async (page) => hold(page, 600),
      },
      {
        text: "CreditMap plans the credits,",
        action: async (page, ctx) => clickAnimated(page, tab("creditmap"), ctx),
        replay: async (page) => goTab(page, "creditmap"),
      },
      {
        text: "Retainer prices the service,",
        action: async (page, ctx) => clickAnimated(page, tab("retainer"), ctx),
        replay: async (page) => goTab(page, "retainer"),
      },
      {
        text: "Proven puts ad money behind what's proven.",
        action: async (page, ctx) => clickAnimated(page, tab("proven"), ctx),
        replay: async (page) => goTab(page, "proven"),
      },
      {
        text: "One thread: credits, to price, to proof.",
        action: async (page) => hold(page, 600),
      },
    ],
  },
  {
    name: "07-how-to-use",
    cursor: true,
    setup: async (page) => {
      await unlockPage(page);
      await goTab(page, "proven");
      await initCursor(page);
    },
    segments: [
      {
        text: "If you ever get stuck, the How to Use tab walks through every tool step by step,",
        action: async (page, ctx) => clickAnimated(page, tab("guide"), ctx),
        replay: async (page) => goTab(page, "guide"),
      },
      {
        text: "so there's no learning curve to worry about.",
        action: async (page) => {
          for (let i = 0; i < 4; i++) {
            await page.evaluate(() => window.scrollBy({ top: 520, behavior: "smooth" }));
            await page.waitForTimeout(1100);
          }
        },
      },
    ],
  },
  {
    name: "08-login-static",
    cursor: false,
    setup: async (page) => {
      await page.goto(BASE_URL);
      await page.waitForSelector("#gatePassword");
    },
    segments: [
      {
        text: "That's Payback: a free companion that turns your credits and scores into a plan, a price and proof. Grab Postonomous, then use your bonus link and password to unlock Payback. Run your own numbers, and enjoy.",
        action: async (page) => hold(page, 400),
      },
    ],
  },
];

(async () => {
  const only = (process.env.ONLY_BEATS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const beatsToRun = only.length ? BEATS.filter((b) => only.includes(b.name)) : BEATS;

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

  for (const beat of beatsToRun) {
    const beatDir = path.join(OUTPUT_DIR, beat.name);
    fs.mkdirSync(beatDir, { recursive: true });
    const manifest = [];
    const replaysSoFar = [];
    let lastScrollY = null;
    let lastCursorPos = null;

    for (let i = 0; i < beat.segments.length; i++) {
      const seg = beat.segments[i];
      const segDir = path.join(beatDir, `seg${String(i + 1).padStart(2, "0")}`);

      // Capture beatStart BEFORE newContext(), not after — timestamping
      // after context creation caused systematic drift between the logged
      // click time and the actual click frame in testing.
      const beatStart = Date.now();
      const context = await browser.newContext({
        viewport: VIEWPORT,
        recordVideo: { dir: segDir, size: VIEWPORT },
      });
      const page = await context.newPage();
      const ctx = { beatStart, clicks: [] };

      await beat.setup(page, ctx);
      if (beat.cursor && replaysSoFar.length) {
        await page.evaluate(() => { window.__suppressEffects = true; });
      }
      for (const replay of replaysSoFar) {
        await replay(page);
      }
      if (beat.cursor && replaysSoFar.length) {
        await page.evaluate(() => { window.__suppressEffects = false; });
      }

      if (i === 0) {
        if (beat.cursor) await centerCursor(page);
      } else {
        if (lastScrollY !== null) {
          await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), lastScrollY);
        }
        if (beat.cursor && lastCursorPos) {
          await page.mouse.move(lastCursorPos.x, lastCursorPos.y);
        }
        await page.waitForTimeout(150);
      }

      // See file header ("INVISIBLE-BUT-ACTUALLY-VISIBLE PREFIX") — mark the
      // boundary and trim everything before it out in assembly.
      const visibleStart = round((Date.now() - beatStart) / 1000);

      await seg.action(page, ctx);
      await page.waitForTimeout(300);

      lastScrollY = await page.evaluate(() => window.scrollY);
      if (beat.cursor) {
        lastCursorPos = await page.evaluate(() => {
          const c = document.getElementById("__fake-cursor");
          if (!c) return null;
          return { x: parseFloat(c.style.left) || 0, y: parseFloat(c.style.top) || 0 };
        });
      }

      await context.close(); // video only finalizes to disk on context close

      fs.writeFileSync(
        path.join(segDir, "clicks.json"),
        JSON.stringify({ visibleStart, clicks: ctx.clicks })
      );
      manifest.push({ index: i + 1, text: seg.text, dir: `seg${String(i + 1).padStart(2, "0")}` });
      if (seg.replay) replaysSoFar.push(seg.replay);
      console.log(`  ${beat.name} seg${String(i + 1).padStart(2, "0")}: ${ctx.clicks.length} click(s)`);
    }

    fs.writeFileSync(path.join(beatDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`Recorded beat: ${beat.name} — ${manifest.length} segments`);
  }

  await browser.close();
  console.log(`Done. Recordings in ${OUTPUT_DIR}/<beat-name>/manifest.json + segNN/*.webm + clicks.json`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Re-measuring cursor tip offset (if you change CURSOR_SVG or the box size):
 *
 * 1. Render just the cursor div (no page content) onto a solid, unambiguous
 *    background color at a known anchor position, e.g. left:150px;top:150px.
 * 2. Screenshot it, then scan pixels in raster order (y outer, x inner)
 *    starting at the anchor coordinate for the first non-background pixel —
 *    that's the tip's rendered offset from the anchor.
 * 3. Verify by rendering the click-ring at (anchor + candidate offset) next
 *    to the cursor and visually confirming the ring is centered on the tip
 *    with the cursor rendered in front — try a small grid of nearby
 *    candidate offsets (±2px) side by side and pick the best visual match,
 *    don't stop at the first pixel-scan result without a visual check.
 * 4. Never trust viewBox-ratio math for this (scaleX * tip.x, scaleY *
 *    tip.y) — it was tried twice on this project and was off both times
 *    (stroke width, anti-aliasing, and preserveAspectRatio letterboxing all
 *    threw it off in ways that were hard to predict analytically). Always
 *    measure empirically against an actual render.
 */
