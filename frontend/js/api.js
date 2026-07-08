/* ─────────────────────────────────────────────────────────────────────────────
   api.js  —  All fetch calls to the FastAPI backend.

   FILE ROLE:
     Single source of truth for every API URL.
     All page JS files call methods on the API object — they never
     construct fetch() calls themselves.

   USAGE (from app.js and page JS files):
     API.overview(trialId, [1,2,3])  → GET /api/trial/{tid}/overview?path_runs=1,2,3
     API.safety(trialId, selPaths)
     API.fleet(trialId, selPaths)
     API.temporal(trialId, selPaths)
     API.mlRisk(trialId, selPaths)   → GET /api/trial/{tid}/ml_risk?…
     API.algoDiag(trialId, selPaths) → GET /api/trial/{tid}/algo_diag?…
     API.spatial(trialId, selPaths)  → GET /api/trial/{tid}/spatial?…
     API.multitrailIntel(tid, prs)   → GET /api/multitrail_intel?trial=…
     API.connectPG(host,port,db,user,pw) → POST /api/connect/postgres
     API.connectXL(file)             → POST /api/connect/excel
     API.trials()                    → GET /api/trials
     API.pathRuns(trialId)           → GET /api/trial/{tid}/path_runs

   BASE URL: http://127.0.0.1:8000 (FastAPI server default)
   Change BASE if deploying to a different host/port.
──────────────────────────────────────────────────────────────────────────── */
const API = (() => {
  const BASE = 'http://127.0.0.1:8000';

  async function _post(path, form) {
    const fd = new FormData();
    Object.entries(form).forEach(([k,v]) => fd.append(k, v));
    const r = await fetch(BASE + path, { method:'POST', body:fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function _get(path) {
    const r = await fetch(BASE + path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  return {
    connectPG: (host,port,dbname,user,password) =>
      _post('/api/connect/postgres', {host,port,dbname,user,password}),
    connectXL: (file) => {
      const fd = new FormData(); fd.append('file', file);
      return fetch(BASE+'/api/connect/excel',{method:'POST',body:fd}).then(r=>r.json());
    },
    trials:   ()         => _get('/api/trials'),
    pathRuns: (tid)      => _get(`/api/trial/${tid}/path_runs`),
    overview: (tid,prs)  => _get(`/api/trial/${tid}/overview?path_runs=${prs.join(',')}`),
    spatial:  (tid,prs)  => _get(`/api/trial/${tid}/spatial?path_runs=${prs.join(',')}`),
    safety:   (tid,prs)  => _get(`/api/trial/${tid}/safety?path_runs=${prs.join(',')}`),
    fleet:    (tid,prs)  => _get(`/api/trial/${tid}/fleet?path_runs=${prs.join(',')}`),
    temporal: (tid,prs)  => _get(`/api/trial/${tid}/temporal?path_runs=${prs.join(',')}`),
    mlRisk:   (tid,prs)  => _get(`/api/trial/${tid}/ml_risk?path_runs=${prs.join(',')}`),
    algoDiag: (tid,prs)  => _get(`/api/trial/${tid}/algo_diag?path_runs=${prs.join(',')}`),
    multitrailIntel: (tid,prs) => _get(`/api/multitrail_intel${tid?`?trial=${tid}&path_runs=${(prs||[]).join(',')}`:''}`)  ,
  };
})();
