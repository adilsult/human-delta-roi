/* ============================================================
   Human Delta — AI KB ROI Calculator  ·  app.js
   All calculator logic. No external dependencies.
   ============================================================ */

'use strict';

// ── Recovery scenario presets ────────────────────────────────
const PRESETS = {
  conservative: { e: .50, c: .35, r: .50, l: 'Conservative' },
  base:         { e: .70, c: .55, r: .65, l: 'Base Case'    },
  aggressive:   { e: .90, c: .75, r: .85, l: 'Aggressive'   },
};
let preset = PRESETS.base;

// ── Usage-distribution multipliers ──────────────────────────
const DIST = { uniform: 1.0, concentrated: 0.6, distributed: 1.3 };
let distMult = 1.0;

// ── Sensitivity dimension ────────────────────────────────────
let sensDim = 'churn';

// ── KB review process (guided mode) ─────────────────────────
let reviewProcess = 'no';

// ── Industry presets (guided mode) ──────────────────────────
const IND_PRESETS = {
  smb: {
    articles: 200,  stale: 80,   contrib: 3,  convos: 3000,  tickets: 180,
    wrong: 60,      mult: 7,     ticketCost: 35,  customers: 150,  acv: 800,
    churnMentions: 3,  totalChurned: 15,  kbHours: 20,  kbRate: 40,
    platform: 800,  setup: 2000,
  },
  mid: {
    articles: 600,  stale: 250,  contrib: 10, convos: 18000, tickets: 1200,
    wrong: 420,     mult: 7,     ticketCost: 50,  customers: 1200, acv: 8000,
    churnMentions: 18, totalChurned: 80,   kbHours: 60,  kbRate: 65,
    platform: 5000, setup: 10000,
  },
  ent: {
    articles: 2000, stale: 900,  contrib: 30, convos: 80000, tickets: 5600,
    wrong: 2000,    mult: 7,     ticketCost: 75,  customers: 400,  acv: 60000,
    churnMentions: 12, totalChurned: 30,   kbHours: 200, kbRate: 90,
    platform: 15000, setup: 25000,
  },
};

// ============================================================
// Helpers
// ============================================================

/** Read a number input by element id. */
function gv(id) { return parseFloat(document.getElementById(id).value) || 0; }

/** Read a guided-mode input by element id. */
function gd(id) { return parseFloat(document.getElementById(id).value) || 0; }

/** Format dollar amount: auto K / M suffixes. */
function fmt(v) {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v).toLocaleString();
}

/** Format large numbers (no $). */
function fmtN(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (Math.round(v / 100) * 100).toLocaleString();
  return Math.round(v).toLocaleString();
}

/** Format in $K for sensitivity table. */
function fmtK(v) { return '$' + Math.round(v / 1000) + 'K'; }

/** Format payback period. */
function pfmt(v) {
  if (!isFinite(v)) return '—';
  if (v < 1)        return '< 1 mo';
  if (v < 12)       return Math.round(v) + ' mo';
  return (v / 12).toFixed(1) + ' yr';
}

/** Flash animation on a DOM element, then update its text. */
function anim(id, txt) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth; // reflow to restart animation
  el.classList.add('flash');
  el.textContent = txt;
}

// ============================================================
// Mode switching
// ============================================================

function setMode(m) {
  ['guided', 'expert'].forEach(k => {
    document.getElementById('mode-' + k).classList.toggle('active', k === m);
    document.getElementById('section-' + k).classList.toggle('visible', k === m);
  });
  if (m === 'expert') calc();
}

// ============================================================
// Guided mode — derivation logic
// ============================================================

function setProcess(p) {
  reviewProcess = p;
  ['no', 'inf', 'yes'].forEach(k => document.getElementById('g-process-' + k).classList.remove('on'));
  // map "no" → g-process-no, "informal" → g-process-inf, "formal" → g-process-yes
  const btnMap = { no: 'no', informal: 'inf', formal: 'yes' };
  document.getElementById('g-process-' + btnMap[p]).classList.add('on');
  updateDerived();
}

/**
 * Conflict Rate derivation
 * Base: stale% of articles
 * Modifier: contributors (more = more divergence)
 * Modifier: process governance factor
 */
function deriveConflictRate() {
  const total   = Math.max(gd('g-total-articles'), 1);
  const stale   = Math.min(gd('g-stale-articles'), total);
  const contrib = gd('g-contributors');
  const stalePct = stale / total;
  const contribFactor = contrib <= 2 ? 0.8 : contrib <= 5 ? 1.0 : contrib <= 10 ? 1.15 : 1.3;
  const processFactor = { no: 1.3, informal: 1.0, formal: 0.65 }[reviewProcess];
  const cr = Math.min(90, Math.round(stalePct * 100 * contribFactor * processFactor * 0.55));
  return Math.max(3, cr);
}

/** Deflection Failure Rate: tickets after AI / AI convos */
function deriveEscRate() {
  const convos  = Math.max(gd('g-ai-convos'), 1);
  const tickets = gd('g-ai-tickets');
  return Math.min(80, Math.round(tickets / convos * 100));
}

/**
 * Hallucination Rate: wrong-AI tickets × silent multiplier / total AI convos
 * Silent multiplier accounts for users who don't file tickets (Forrester/Zendesk: 5–10×).
 */
function deriveHallRate() {
  const convos      = Math.max(gd('g-ai-convos'), 1);
  const wrong       = gd('g-wrong-tickets');
  const silentMult  = Math.max(gd('g-silent-mult'), 1);
  const estimatedHall = wrong * silentMult;
  return Math.min(95, Math.max(10, Math.round(estimatedHall / convos * 100)));
}

/** AI-Attributable Churn Rate */
function deriveChurnRate() {
  const cr = deriveConflictRate() / 100;
  const hr = deriveHallRate() / 100;
  const dailyQ = gd('g-ai-convos') / 30;
  const badPerYear = dailyQ * cr * hr * 365;
  const custs  = Math.max(gd('g-customers'), 1);
  const qpc    = 200; // default assumption for guided mode
  const impacted = Math.min(custs, badPerYear / qpc);
  const mentions = gd('g-churn-mentions');
  const annualizedMentions = mentions * 2;
  const rate = impacted > 0
    ? Math.min(80, Math.round(annualizedMentions / impacted * 100))
    : 5;
  return Math.max(1, rate);
}

/** Rework caused by conflicts — proxy via stale article ratio */
function deriveReworkCaused() {
  const total = Math.max(gd('g-total-articles'), 1);
  const stale = Math.min(gd('g-stale-articles'), total);
  return Math.min(90, Math.max(20, Math.round(stale / total * 100 * 0.8)));
}

/** Update the "Derived Parameters" panel in guided mode */
function updateDerived() {
  const cr     = deriveConflictRate();
  const er     = deriveEscRate();
  const hr     = deriveHallRate();
  const ch     = deriveChurnRate();
  const rw     = deriveReworkCaused();
  const dailyQ = Math.round(gd('g-ai-convos') / 30);

  document.getElementById('d-conflict').textContent = cr + '%';
  document.getElementById('d-escrate').textContent  = er + '%';
  document.getElementById('d-hallrate').textContent = hr + '%';
  document.getElementById('d-churn').textContent    = ch + '%';
  document.getElementById('d-daily').textContent    = dailyQ.toLocaleString() + '/day';
  document.getElementById('d-rework').textContent   = rw + '%';

  const stalePct  = Math.round(gd('g-stale-articles') / Math.max(gd('g-total-articles'), 1) * 100);
  const procLabel = { no: 'no process', informal: 'informal review', formal: 'formal review' }[reviewProcess];
  document.getElementById('d-conflict-src').textContent =
    stalePct + '% stale × ' + procLabel + ' × ' + gd('g-contributors') + ' contributors';

  // ── Sanity check: compare daily-Q-based vs customer-based annual queries ──
  runSanityCheck(dailyQ, cr, hr);
}

/**
 * Sanity check in Expert Mode:
 * Compares implied annual queries (dailyQ × 365) with
 * customer-derived annual queries (customers × qPerCust).
 * Shows a non-blocking warning if they diverge > 3×.
 */
function runSanityCheck(dailyQOverride, crOverride, hrOverride) {
  // We run this in both modes; fall back to expert fields when not in guided context
  const dailyQ = dailyQOverride != null ? dailyQOverride : gv('dailyQ');
  const custs  = gv('customers') || gd('g-customers');
  const qpc    = gv('qPerCust') || 200;

  const impliedAnnual   = dailyQ * 365;
  const customerAnnual  = custs * qpc;

  const bannerEl = document.getElementById('sanity-banner');
  if (!bannerEl) return;

  if (customerAnnual === 0 || impliedAnnual === 0) { bannerEl.style.display = 'none'; return; }

  const ratio = Math.max(impliedAnnual, customerAnnual) / Math.min(impliedAnnual, customerAnnual);

  if (ratio > 3) {
    bannerEl.style.display = 'block';
    document.getElementById('sanity-implied').textContent  = Math.round(impliedAnnual).toLocaleString();
    document.getElementById('sanity-customer').textContent = Math.round(customerAnnual).toLocaleString();
    document.getElementById('sanity-ratio').textContent    = ratio.toFixed(1) + '×';
  } else {
    bannerEl.style.display = 'none';
  }
}

// ============================================================
// Guided → Expert transfer
// ============================================================

function deriveAndSwitch() {
  const cr = deriveConflictRate();
  const er = deriveEscRate();
  const hr = deriveHallRate();
  const ch = deriveChurnRate();
  const rw = deriveReworkCaused();
  const dailyQ = Math.round(gd('g-ai-convos') / 30);

  // Populate expert sliders & inputs, show auto-filled badges
  setSlider('conflictRate', 'dv-cr', cr);
  setSlider('hallRate',     'dv-hr', hr);
  setSlider('escRate',      'dv-er', er);
  setSlider('churnRate',    'dv-ch', ch);
  setSlider('reworkCaused', 'dv-rc', rw);
  setInput('dailyQ',      dailyQ,               'badge-dailyQ');
  setInput('customers',   gd('g-customers'),     'badge-customers');
  setInput('escCost',     gd('g-ticket-cost'),   'badge-esc');
  setInput('acv',         gd('g-acv'),           'badge-acv');
  setInput('reworkH',     gd('g-kb-hours'),      'badge-rh');
  setInput('reworkRate',  gd('g-kb-rate'),       'badge-rate');
  setInput('moPlatform',  gd('g-mo-platform'),   'badge-mpl');
  setInput('setupCost',   gd('g-setup'),         'badge-setup');
  setSlider('attrWeight', 'dv-aw', 15); // default CFO filter

  // Show auto badges on slider fields
  ['badge-cr', 'badge-hr', 'badge-er', 'badge-ch', 'badge-rc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'inline';
  });

  setMode('expert');
}

function setSlider(id, dvId, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  el.classList.add('auto-filled');
  document.getElementById(dvId).textContent = val + '%';
}

function setInput(id, val, badgeId) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  el.classList.add('auto-filled');
  if (badgeId) {
    const b = document.getElementById(badgeId);
    if (b) b.style.display = 'inline';
  }
}

// ============================================================
// Industry presets
// ============================================================

function applyPreset(k) {
  ['smb', 'mid', 'ent'].forEach(id =>
    document.getElementById('preset-' + id).classList.remove('active', 'active-preset')
  );
  document.getElementById('preset-' + k).classList.add('active-preset');

  const p = IND_PRESETS[k];
  const fields = {
    'g-total-articles': p.articles, 'g-stale-articles': p.stale,
    'g-contributors':   p.contrib,  'g-ai-convos':      p.convos,
    'g-ai-tickets':     p.tickets,  'g-wrong-tickets':  p.wrong,
    'g-silent-mult':    p.mult,     'g-ticket-cost':    p.ticketCost,
    'g-customers':      p.customers,'g-acv':            p.acv,
    'g-churn-mentions': p.churnMentions, 'g-total-churned': p.totalChurned,
    'g-kb-hours':       p.kbHours,  'g-kb-rate':        p.kbRate,
    'g-mo-platform':    p.platform, 'g-setup':          p.setup,
  };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });

  setMode('guided');
  updateDerived();
}

// ============================================================
// Recovery scenario + distribution helpers
// ============================================================

function setPreset(k) {
  preset = PRESETS[k];
  ['cons', 'base', 'agg'].forEach(id =>
    document.getElementById('pr-' + id).classList.remove('on')
  );
  document.getElementById('pr-' + { conservative: 'cons', base: 'base', aggressive: 'agg' }[k]).classList.add('on');
  document.getElementById('r-esc').textContent  = Math.round(preset.e * 100) + '%';
  document.getElementById('r-ch').textContent   = Math.round(preset.c * 100) + '%';
  document.getElementById('r-rw').textContent   = Math.round(preset.r * 100) + '%';
  document.getElementById('preset-lbl').textContent = preset.l;
  calc();
}

function setDist(d) {
  distMult = DIST[d];
  ['uniform', 'concentrated', 'distributed'].forEach(k =>
    document.getElementById('tog-' + k).classList.remove('on')
  );
  document.getElementById('tog-' + d).classList.add('on');
  const hints = {
    uniform:      'Assumes bad responses spread evenly across users (rough estimate)',
    concentrated: 'Power-user skew: fewer unique customers exposed (×0.6)',
    distributed:  'Thin-usage base: more unique customers exposed (×1.3)',
  };
  document.getElementById('dist-hint').textContent = hints[d];
  calc();
}

function setDim(d) {
  sensDim = d;
  ['churn', 'hall', 'esc'].forEach(k =>
    document.getElementById('dim-' + k).classList.remove('on')
  );
  document.getElementById('dim-' + d).classList.add('on');
  buildSens();
}

// ============================================================
// Core cost computation
// ============================================================

/**
 * Compute annual costs given a conflict rate and an optional
 * override value for one sensitivity dimension.
 *
 * @param {number} crPct  – conflict rate (percent)
 * @param {number|null} ovVal  – override value (percent) for sensitivity
 * @param {string|null} ovDim  – which dimension to override ('hall'|'esc'|'churn')
 */
function computeCost(crPct, ovVal, ovDim) {
  const dailyQ  = gv('dailyQ');
  const custs   = gv('customers');
  const qpc     = Math.max(gv('qPerCust'), 1);
  const escC    = gv('escCost');
  const acv     = gv('acv');
  const rar     = gv('revAtRisk') / 100;
  const rH      = gv('reworkH');
  const rCaused = gv('reworkCaused') / 100;
  const rRate   = gv('reworkRate');

  // Allow sensitivity overrides per dimension
  const hallR = (ovDim === 'hall'  ? ovVal : gv('hallRate'))  / 100;
  const escR  = (ovDim === 'esc'   ? ovVal : gv('escRate'))   / 100;
  const chR   = (ovDim === 'churn' ? ovVal : gv('churnRate')) / 100;
  const cr    = crPct / 100;

  const badDay    = dailyQ * cr * hallR;
  const badYear   = badDay * 365;
  const impacted  = Math.min(custs, Math.min(custs, badYear / qpc) * distMult);
  const churned   = impacted * chR;
  const cEsc      = badYear * escR * escC;
  const cCh       = churned * acv * rar; // attrWeight baked into churnRate derivation
  const cRw       = rH * 12 * rRate * rCaused;

  return { badDay, impacted, escYear: badYear * escR, churned, cEsc, cCh, cRw, tot: cEsc + cCh + cRw };
}

// ============================================================
// Main calculation + DOM update
// ============================================================

function calc() {
  const crBase = gv('conflictRate');
  const res    = computeCost(crBase, null, null);

  const moPl   = gv('moPlatform');
  const setup  = gv('setupCost');
  const annPl  = moPl * 12;
  const totInv = annPl + setup;

  const sEsc   = res.cEsc * preset.e;
  const sCh    = res.cCh  * preset.c;
  const sRw    = res.cRw  * preset.r;
  const sTot   = sEsc + sCh + sRw;

  const netBen  = sTot - annPl;
  const roiRec  = annPl  > 0 ? netBen / annPl  * 100 : 0;
  const roiYr1  = totInv > 0 ? (sTot - totInv) / totInv * 100 : 0;
  const payMo   = sTot   > 0 ? totInv / sTot * 12 : Infinity;

  // ── Metrics ─────────────────────────────────────────────
  anim('o-bad', fmtN(res.badDay) + '/day');
  anim('o-imp', fmtN(res.impacted) + ' users');
  const impSubEl = document.getElementById('o-imp-sub');
  if (impSubEl) impSubEl.textContent = 'rough est · ' + (distMult === 1 ? 'uniform' : 'adjusted') + ' dist';
  anim('o-esc', fmtN(res.escYear));
  anim('o-ch',  fmtN(res.churned) + ' at risk');
  anim('o-total', fmt(res.tot));

  // CTA total mirror
  const ctaEl = document.getElementById('cta-total');
  if (ctaEl) ctaEl.textContent = fmt(res.tot);

  const descEl = document.getElementById('o-desc');
  if (descEl) descEl.textContent = fmtN(res.impacted) + ' customers exposed · ' + fmtN(res.churned) + ' AI-attributable churn estimate';

  // ── ROI strip ────────────────────────────────────────────
  anim('o-nab', (netBen >= 0 ? '+' : '') + fmt(netBen));
  const nabEl = document.getElementById('o-nab');
  if (nabEl) nabEl.className = 'rcv ' + (netBen >= 0 ? 'g' : 'r');

  anim('o-roi-rec', (roiRec >= 0 ? '+' : '') + Math.round(roiRec) + '%');
  const roiRecEl = document.getElementById('o-roi-rec');
  if (roiRecEl) roiRecEl.className = 'rcv ' + (roiRec >= 0 ? 'o' : 'r');

  anim('o-roi-yr1', (roiYr1 >= 0 ? '+' : '') + Math.round(roiYr1) + '%');
  const roiYr1El = document.getElementById('o-roi-yr1');
  if (roiYr1El) roiYr1El.className = 'rcv ' + (roiYr1 >= 0 ? 'b' : 'r');

  anim('o-payback', pfmt(payMo));

  // Attribution weight badge in breakdown
  const awBadge = document.getElementById('aw-badge');
  if (awBadge) awBadge.textContent = '(' + gv('attrWeight') + '% attr.)';

  // ── Breakdown ────────────────────────────────────────────
  anim('br-esc', '–' + fmt(res.cEsc));
  anim('br-ch',  '–' + fmt(res.cCh));
  anim('br-rw',  '–' + fmt(res.cRw));
  anim('br-tot', '–' + fmt(res.tot));
  anim('sv-esc', '+' + fmt(sEsc));
  anim('sv-ch',  '+' + fmt(sCh));
  anim('sv-rw',  '+' + fmt(sRw));
  anim('sv-tot', '+' + fmt(sTot));
  anim('pi-yr',  fmt(annPl));
  anim('pi-su',  fmt(setup));
  anim('pi-tot', fmt(totInv));
  anim('pb-mo',  pfmt(payMo));
  anim('pb-roi-rec', (roiRec >= 0 ? '+' : '') + Math.round(roiRec) + '%');
  anim('pb-roi-yr1', (roiYr1 >= 0 ? '+' : '') + Math.round(roiYr1) + '%');

  // ── Sanity check (expert mode) ───────────────────────────
  runSanityCheck(null, null, null);

  buildSens();
}

// ============================================================
// Sensitivity table
// ============================================================

function buildSens() {
  const crBase = gv('conflictRate');
  const crLow  = Math.max(1,  crBase * 0.5);
  const crHigh = Math.min(90, crBase * 1.7);

  const cfg = {
    churn: { id: 'churnRate', label: 'Churn Rate',       max: 80 },
    hall:  { id: 'hallRate',  label: 'Hall. Rate',        max: 95 },
    esc:   { id: 'escRate',   label: 'Esc. Rate',         max: 80 },
  }[sensDim];

  const base = gv(cfg.id);
  const low  = Math.max(1, base * 0.5);
  const high = Math.min(cfg.max, base * 1.7);

  document.getElementById('sh-corner').textContent = 'Conflict Rate →\n' + cfg.label + ' ↓';
  document.getElementById('sh-low').textContent    = 'Low ('  + Math.round(crLow)  + '%)';
  document.getElementById('sh-base').textContent   = 'Base (' + Math.round(crBase) + '%)';
  document.getElementById('sh-high').textContent   = 'High (' + Math.round(crHigh) + '%)';

  const baseTot = computeCost(crBase, base, sensDim).tot;
  const rows = [
    { label: 'Low ('  + Math.round(low)  + '%)', val: low            },
    { label: 'Base (' + Math.round(base) + '%)', val: base, isBase: true },
    { label: 'High (' + Math.round(high) + '%)', val: high           },
  ];

  const tbody = document.getElementById('sens-body');
  tbody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    if (row.isBase) tr.className = 'base-row';
    let html = '<td>' + row.label + '</td>';
    [crLow, crBase, crHigh].forEach((cr, ci) => {
      const t   = computeCost(cr, row.val, sensDim).tot;
      const cls = (row.isBase && ci === 1) ? '' : t > baseTot ? 'hi' : 'lo';
      html += '<td class="' + cls + '">' + fmtK(t) + '</td>';
    });
    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
}

// ============================================================
// Export / Copy
// ============================================================

/**
 * Download a .txt executive summary with inputs + results.
 * Format: short summary block (top 8 lines) + full breakdown.
 */
function exportSummary() {
  const moPl   = gv('moPlatform');
  const setup  = gv('setupCost');
  const annPl  = moPl * 12;
  const totInv = annPl + setup;
  const ts     = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const lines = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  Human Delta · AI KB ROI Calculator — Executive Summary',
    '  Generated: ' + ts,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '[ SUMMARY ]',
    '  Total Annual Cost of Broken AI:   ' + (document.getElementById('o-total').textContent || '—'),
    '  Recoverable Savings (' + preset.l + '):  ' + (document.getElementById('sv-tot').textContent  || '—'),
    '  Net Annual Benefit:               ' + (document.getElementById('o-nab').textContent   || '—'),
    '  ROI (Recurring, excl. setup):     ' + (document.getElementById('pb-roi-rec').textContent || '—'),
    '  ROI (Year-1, incl. setup):        ' + (document.getElementById('pb-roi-yr1').textContent || '—'),
    '  Payback Period:                   ' + (document.getElementById('pb-mo').textContent    || '—'),
    '',
    '[ KEY METRICS ]',
    '  Bad AI Responses/Day:             ' + (document.getElementById('o-bad').textContent    || '—'),
    '  Escalations/Year:                 ' + (document.getElementById('o-esc').textContent    || '—'),
    '  Customers at Risk of Churn:       ' + (document.getElementById('o-ch').textContent     || '—'),
    '',
    '[ INPUTS ]',
    '  Conflict Rate:                    ' + gv('conflictRate') + '%',
    '  Hallucination Rate:               ' + gv('hallRate')     + '%',
    '  Deflection Failure Rate:          ' + gv('escRate')      + '%',
    '  AI-Attributable Churn Rate:       ' + gv('churnRate')    + '%',
    '  Daily AI Queries:                 ' + gv('dailyQ').toLocaleString(),
    '  Total Customers:                  ' + gv('customers'),
    '  ACV per Customer:                 $' + gv('acv'),
    '  Cost per Escalation:              $' + gv('escCost'),
    '  KB Rework Hours/Month:            ' + gv('reworkH'),
    '  Hourly Rate:                      $' + gv('reworkRate'),
    '  Monthly Platform Cost:            $' + moPl,
    '  One-Time Setup Cost:              $' + setup,
    '  Recovery Scenario:                ' + preset.l,
    '',
    '[ COST BREAKDOWN ]',
    '  Support Escalation Cost:          ' + (document.getElementById('br-esc').textContent || '—'),
    '  AI-Attributable Churn:            ' + (document.getElementById('br-ch').textContent  || '—'),
    '  KB Conflict Rework Labor:         ' + (document.getElementById('br-rw').textContent  || '—'),
    '  Total Annual Exposure:            ' + (document.getElementById('br-tot').textContent || '—'),
    '',
    '[ PLATFORM INVESTMENT ]',
    '  Annual Recurring:                 ' + (document.getElementById('pi-yr').textContent  || '—'),
    '  One-Time Setup:                   ' + (document.getElementById('pi-su').textContent  || '—'),
    '  Total Year-1:                     ' + (document.getElementById('pi-tot').textContent || '—'),
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  ⚠ Directional model only. Validate with actual query logs,',
    '  CRM churn data, and support analytics before CFO presentation.',
    '  Generated with Human Delta ROI Calculator · humandelta.ai',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'roi-summary-humandelta.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Copy a concise summary to clipboard. */
function copySummary() {
  const lines = [
    '── Human Delta · AI KB ROI Summary ──',
    '',
    'Annual Cost of Broken AI:   ' + (document.getElementById('o-total').textContent || '—'),
    'Recoverable Savings:        ' + (document.getElementById('sv-tot').textContent  || '—'),
    'Net Annual Benefit:         ' + (document.getElementById('o-nab').textContent   || '—'),
    'ROI (Recurring):            ' + (document.getElementById('pb-roi-rec').textContent || '—'),
    'ROI (Year-1):               ' + (document.getElementById('pb-roi-yr1').textContent || '—'),
    'Payback Period:             ' + (document.getElementById('pb-mo').textContent    || '—'),
    '',
    'Bad Responses/Day:          ' + (document.getElementById('o-bad').textContent   || '—'),
    'Escalations/Year:           ' + (document.getElementById('o-esc').textContent   || '—'),
    'Customers at Risk:          ' + (document.getElementById('o-ch').textContent    || '—'),
    '',
    'Recovery Scenario:          ' + (document.getElementById('preset-lbl').textContent || '—'),
    '─────────────────────────────────────',
    'Generated with Human Delta ROI Calculator · humandelta.ai',
  ].join('\n');

  navigator.clipboard.writeText(lines).then(() => {
    const btn = document.getElementById('copy-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }
  });
}

// ============================================================
// Event wiring — runs after DOM ready
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  // Expert sliders → update display value + recalc
  [
    ['conflictRate', 'dv-cr'],
    ['hallRate',     'dv-hr'],
    ['escRate',      'dv-er'],
    ['churnRate',    'dv-ch'],
    ['revAtRisk',    'dv-rar'],
    ['reworkCaused', 'dv-rc'],
    ['attrWeight',   'dv-aw'],
  ].forEach(([id, dv]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', e => {
      document.getElementById(dv).textContent = e.target.value + '%';
      calc();
    });
  });

  // Expert number inputs → recalc
  ['dailyQ', 'customers', 'qPerCust', 'escCost', 'acv', 'reworkH', 'reworkRate', 'moPlatform', 'setupCost']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', calc);
    });

  // Guided inputs → update derived panel
  [
    'g-total-articles', 'g-stale-articles', 'g-contributors',
    'g-ai-convos', 'g-ai-tickets', 'g-wrong-tickets', 'g-silent-mult',
    'g-ticket-cost', 'g-customers', 'g-acv', 'g-churn-mentions',
    'g-total-churned', 'g-kb-hours', 'g-kb-rate', 'g-mo-platform', 'g-setup',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateDerived);
  });

  // Initial render
  updateDerived();
  calc();
});
