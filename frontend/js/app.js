/* ─────────────────────────────────────────────────────────────────────────────
   app.js  —  Application state, login, routing, page loader.

   FILE ROLE:
     The main controller. Owns the global state object S, handles the
     login modal, wires the nav links to _loadPage(), and calls the
     correct page renderer after every API response.

   KEY FUNCTIONS:
     _initLoginModal()    Wires PostgreSQL and Excel upload forms.
     _onConnected(res)    Runs after successful connect:
                            stores trials in S, selects first trial,
                            builds path-run buttons, loads Overview.
     _loadPage(page, force)
                          Fetches data via API.* method matching
                          the requested page name, caches it, then
                          calls _render(page, data).
     _render(page, data)  Dispatches to the correct Page.render(data)
                          function (OverviewPage, SafetyPage, …).
     _buildPRBtns()       Rebuilds the path-run selector buttons in
                          the sidebar based on S.pathRuns.
     initChartTabs()      Wires tab buttons inside the trial panel
                          for comparison charts.

   GLOBAL STATE  (S object):
     connected   bool      — whether a data source is loaded
     trials      string[]  — list of trial_id values
     trial       string    — currently selected trial_id
     pathRuns    number[]  — path run numbers for current trial
     pathLabels  {}        — run number → display label
     selPaths    number[]  — currently selected path runs
     page        string    — active page name ("overview", "safety", …)
     cache       {}        — keyed by "page:trial:paths" to avoid
                            redundant API calls on nav revisit
     user        string    — username shown in sidebar
     allTrialData {}       — last loaded data per trial (for comparison)

   PAGE NAME → API METHOD → PAGE RENDERER:
     "overview"   → API.overview()   → OverviewPage.render()
     "airspace"   → API.spatial()    → AirspacePage.render()
     "safety"     → API.safety()     → SafetyPage.render()
     "fleet"      → API.fleet()      → FleetPage.render()
     "temporal"   → API.temporal()   → TemporalPage.render()
     "predictive" → API.mlRisk()     → PredictivePage.render()
     "algo"       → API.algoDiag()   → AlgoPage.render()
     "intel"      → API.multitrailIntel() → IntelPage.render()
──────────────────────────────────────────────────────────────────────────── */

const S = {
  connected: false, trials: [], trial: null,
  pathRuns: [], pathLabels: {}, selPaths: [],
  page: 'overview', cache: {},
  user: null,
  allTrialData: {}   // stores last loaded data per trial for comparison
};

document.addEventListener('DOMContentLoaded', () => {
  _clock();
  _initLoginModal();
  _initNav();
  _initTrialPanel();
  initChartTabs();
  UTMMap.initSearch();
  UTMMap.initFilter();
});

/* ── CLOCK ── */
function _clock() {
  const tick = () => {
    const d=new Date(), h=d.getHours(), m=d.getMinutes(), s=d.getSeconds();
    const ap=h>=12?'PM':'AM', hh=h%12||12;
    const el=document.getElementById('live-clock');
    if (el) el.textContent=`${_z(hh)}:${_z(m)}:${_z(s)} ${ap}`;
  };
  tick(); setInterval(tick, 1000);
}
function _z(n) { return String(n).padStart(2,'0'); }

/* ── LOGIN MODAL ── */
function _initLoginModal() {
  document.querySelectorAll('.login-tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.login-tab').forEach(x => x.classList.remove('active-tab'));
      document.querySelectorAll('.login-form').forEach(x => x.classList.add('hidden'));
      t.classList.add('active-tab');
      document.getElementById('lf-'+t.dataset.tab)?.classList.remove('hidden');
    });
  });

  document.getElementById('btn-pg')?.addEventListener('click', async () => {
    const st = document.getElementById('login-status');
    _stat(st,'','— Connecting…');
    try {
      const r = await API.connectPG(
        document.getElementById('pg-host').value,
        document.getElementById('pg-port').value,
        document.getElementById('pg-db').value,
        document.getElementById('pg-user').value,
        document.getElementById('pg-pass').value
      );
      await _onConnected(r, document.getElementById('pg-user').value);
    } catch(e) { _stat(st,'err','✗ '+e.message); }
  });

  document.getElementById('btn-xl')?.addEventListener('click', async () => {
    const file = document.getElementById('xl-file')?.files[0]; if (!file) return;
    const st = document.getElementById('login-status');
    _stat(st,'','— Loading…');
    try { const r = await API.connectXL(file); await _onConnected(r,'Researcher'); }
    catch(e) { _stat(st,'err','✗ '+e.message); }
  });
}

async function _onConnected(res, username) {
  S.connected = true; S.trials = res.trials || [];
  S.user = username || 'Researcher';
  const st = document.getElementById('login-status');
  _stat(st,'ok',`✓ Connected — ${S.trials.length} trial(s)`);

  const uname = document.getElementById('sidebar-user-name');
  if (uname) uname.textContent = S.user;

  const badge = document.getElementById('live-badge');
  if (badge) { badge.textContent='● LIVE DB'; badge.classList.add('text-brand-success'); badge.classList.remove('text-gray-400'); }

  // Populate trial dropdown
  const sel = document.getElementById('trial-select');
  if (sel) {
    sel.innerHTML = S.trials.map(t => `<option value="${t}">${t}</option>`).join('');
    sel.addEventListener('change', () => _selectTrial(sel.value));
  }

  // Build trial toggle panel
  _buildTrialToggles();

  if (S.trials.length) {
    await _selectTrial(S.trials[S.trials.length-1]);
    setTimeout(() => {
      const modal = document.getElementById('login-modal');
      if (modal) {
        modal.style.opacity = '0'; modal.style.transition = 'opacity .4s';
        setTimeout(() => modal.remove(), 400);
      }
    }, 700);
  }
}

/* ── TRIAL TOGGLE PANEL ── */
function _initTrialPanel() {
  // Toggle panel visibility
  const toggleBtn = document.getElementById('trial-panel-toggle');
  const panel     = document.getElementById('trial-compare-panel');
  if (!toggleBtn || !panel) return;
  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    toggleBtn.classList.toggle('text-brand-accent');
    toggleBtn.classList.toggle('bg-orange-50');
  });
}

function _buildTrialToggles() {
  const container = document.getElementById('trial-toggle-list');
  if (!container || !S.trials.length) return;

  container.innerHTML = S.trials.map(tid => `
    <div class="trial-toggle-row flex items-center gap-2 p-2 rounded-lg border border-brand-border/50
      hover:border-brand-accent/40 hover:bg-orange-50/30 cursor-pointer transition-all group"
      data-trial="${tid}">
      <div class="trial-check w-4 h-4 rounded border-2 border-brand-border flex items-center justify-center flex-shrink-0 transition-all ${tid===S.trial?'bg-brand-accent border-brand-accent':''}">
        ${tid===S.trial?'<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>':''}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[11px] font-bold text-gray-800 truncate">${tid}</div>
        <div class="text-[9px] font-mono text-gray-400 trial-meta" id="meta-${tid.replace(/\W/g,'_')}">–</div>
      </div>
      <button class="trial-load-btn text-[9px] font-mono font-bold text-brand-accent opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded border border-brand-accent/40 hover:bg-brand-accent hover:text-white"
        data-trial="${tid}">Load</button>
    </div>
  `).join('');

  // Load button click → switch active trial
  container.querySelectorAll('.trial-load-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tid = btn.dataset.trial;
      const sel = document.getElementById('trial-select');
      if (sel) sel.value = tid;
      await _selectTrial(tid);
    });
  });

  // Row click → also load
  container.querySelectorAll('.trial-toggle-row').forEach(row => {
    row.addEventListener('click', async () => {
      const tid = row.dataset.trial;
      const sel = document.getElementById('trial-select');
      if (sel) sel.value = tid;
      await _selectTrial(tid);
    });
  });

  // Fetch quick meta for each trial
  S.trials.forEach(tid => _fetchTrialMeta(tid));
}

async function _fetchTrialMeta(tid) {
  try {
    const pr = await API.pathRuns(tid);
    const runs = pr.path_runs || [];
    const metaEl = document.getElementById('meta-'+tid.replace(/\W/g,'_'));
    if (metaEl) metaEl.textContent = `${runs.length} path run${runs.length!==1?'s':''}`;
  } catch(e) { /* silent */ }
}

function _updateTrialToggles() {
  // Refresh check marks
  document.querySelectorAll('.trial-toggle-row').forEach(row => {
    const tid = row.dataset.trial;
    const isActive = tid === S.trial;
    const check = row.querySelector('.trial-check');
    if (check) {
      check.className = `trial-check w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${isActive?'bg-brand-accent border-brand-accent':'border-brand-border'}`;
      check.innerHTML = isActive ? '<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
    }
  });
}

/* ── TRIAL SELECTION ── */
async function _selectTrial(tid) {
  S.trial = tid; S.selPaths = []; S.cache = {};
  const sel = document.getElementById('trial-select');
  if (sel) sel.value = tid;

  // Update current trial display
  const ctDisplay = document.getElementById('current-trial-display');
  if (ctDisplay) ctDisplay.textContent = tid;

  _updateTrialToggles();

  try {
    const pr = await API.pathRuns(tid);
    S.pathRuns = pr.path_runs || []; S.pathLabels = pr.labels || {};
    S.selPaths = [...S.pathRuns];
    _buildPRBtns();
  } catch(e) { console.warn(e); }

  await _loadPage('overview', true);
}

/* ── PATH RUN BUTTONS ── */
function _buildPRBtns() {
  const w = document.getElementById('pr-btns');
  if (!w || !S.pathRuns.length) return;

  w.innerHTML = `
    <div class="text-[9px] font-mono text-gray-400 uppercase tracking-wider mb-1">Path Runs</div>
    <div class="flex flex-wrap gap-1" id="pr-btn-row">
      ${S.pathRuns.map(pr => `
        <button class="pr-btn px-2 py-1 text-[9px] font-mono font-bold border rounded transition-all
          ${S.selPaths.includes(pr)
            ? 'bg-brand-accent/10 border-brand-accent text-brand-accent'
            : 'bg-white/30 border-brand-border/50 text-gray-400'}"
          data-pr="${pr}" title="${S.pathLabels[pr]||'Path run #'+pr}">
          ${S.pathLabels[pr]||'#'+pr}
        </button>`).join('')}
    </div>
    <div class="flex gap-1 mt-1">
      <button id="pr-all" class="text-[8px] font-mono text-brand-accent hover:underline">All</button>
      <span class="text-[8px] text-gray-300">|</span>
      <button id="pr-none" class="text-[8px] font-mono text-gray-400 hover:text-brand-accent hover:underline">None</button>
    </div>`;

  // Toggle individual
  w.querySelectorAll('.pr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pr = parseInt(btn.dataset.pr);
      if (S.selPaths.includes(pr)) {
        if (S.selPaths.length === 1) return; // keep at least one
        S.selPaths = S.selPaths.filter(x => x !== pr);
      } else {
        S.selPaths.push(pr);
      }
      S.cache = {}; _buildPRBtns(); _loadPage(S.page, true);
    });
  });

  // Select all
  document.getElementById('pr-all')?.addEventListener('click', () => {
    S.selPaths = [...S.pathRuns]; S.cache = {}; _buildPRBtns(); _loadPage(S.page, true);
  });
  // Select none → keep first
  document.getElementById('pr-none')?.addEventListener('click', () => {
    S.selPaths = [S.pathRuns[0]]; S.cache = {}; _buildPRBtns(); _loadPage(S.page, true);
  });
}

/* ── NAV ── */
function _initNav() {
  document.querySelectorAll('.nav-link[data-page]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); _goPage(a.dataset.page); });
  });
}
function _goPage(page) {
  S.page = page;
  document.querySelectorAll('.nav-link').forEach(a => {
    const on = a.dataset.page === page;
    a.classList.toggle('bg-orange-100/50', on); a.classList.toggle('text-brand-accent', on);
    a.classList.toggle('border', on); a.classList.toggle('border-orange-200/50', on);
    a.classList.toggle('font-medium', on); a.classList.toggle('text-gray-600', !on);
  });
  document.querySelectorAll('.page-panel').forEach(p => p.classList.toggle('hidden', p.dataset.page !== page));
  if (S.connected) _loadPage(page, false);
  if (page === 'overview') UTMMap.invalidate();
}

/* ── PAGE LOADER ── */
// _loadPage(page, force)
// Fetches the data payload for the given page name using the matching
// API method, caches the result under "page:trial:selPaths", then
// calls _render(page, data).
// force=true bypasses the cache (used after trial or path-run change).
async function _loadPage(page, force) {
  if (!S.trial) return;
  const k = `${page}:${S.trial}:${S.selPaths.join(',')}`;
  if (!force && S.cache[k]) { _render(page, S.cache[k]); return; }
  try {
    let data;
    if      (page==='overview')   data = await API.overview(S.trial, S.selPaths);
    else if (page==='airspace')   data = await API.spatial(S.trial, S.selPaths);
    else if (page==='safety')     data = await API.safety(S.trial, S.selPaths);
    else if (page==='fleet')      data = await API.fleet(S.trial, S.selPaths);
    else if (page==='temporal')   data = await API.temporal(S.trial, S.selPaths);
    else if (page==='predictive') data = await API.mlRisk(S.trial, S.selPaths);
    else if (page==='algo')       data = await API.algoDiag(S.trial, S.selPaths);
    else if (page==='intel')      data = await API.multitrailIntel(S.trial, S.selPaths);
    S.cache[k] = data;
    S.allTrialData[S.trial] = data;   // store for comparison
    _render(page, data);
  } catch(e) { console.error('loadPage:', e); }
}

// _render(page, data)
// Dispatches the loaded data to the correct page renderer.
// Each branch calls Page.render(data) where Page is the IIFE module
// from the corresponding pages/*.js file.
function _render(page, data) {
  // Double-RAF + 50ms fallback: guarantees ECharts gets real pixel dimensions
  // even when hidden→visible toggle and render happen in the same JS event.
  const deferred = fn => { requestAnimationFrame(() => requestAnimationFrame(() => { fn(); setTimeout(fn, 50); })); };
  if (page === 'airspace')   { deferred(() => AirspacePage.render(data));   return; }
  if (page === 'safety')     { deferred(() => SafetyPage.render(data));     return; }
  if (page === 'temporal')   { deferred(() => TemporalPage.render(data));   return; }
  if (page === 'predictive') { deferred(() => PredictivePage.render(data)); return; }
  if (page === 'fleet')      { deferred(() => FleetPage.render(data));      return; }
  if (page === 'algo')       { deferred(() => AlgoPage.render(data));       return; }
  if (page === 'intel')      { deferred(() => IntelPage.render(data));      return; }
  if (page === 'overview') {
    OverviewPage.render(data);
    setTimeout(() => { UTMMap.init(); UTMMap.invalidate(); }, 200);
  }
}

/* ── Helpers ── */
function _stat(el, type, msg) {
  if (!el) return;
  el.textContent = msg;
  el.className = 'text-[10px] font-mono mt-2 text-center ' +
    (type==='err'?'text-red-500':type==='ok'?'text-brand-success':'text-gray-400');
}

/* ── Coming Soon alert for all "View All / See All" links ── */
function comingSoon() {
  alert('Coming soon');
}
