const API_CANDIDATES = Array.from(new Set([
  localStorage.getItem('christhelper.api') || '',
  'https://api.christhelper.com',
  `${window.location.origin.replace(/\/+$/, '')}/api`,
  `${window.location.origin.replace(/\/+$/, '')}`
].map((value) => String(value || '').replace(/\/+$/, '')).filter(Boolean)));

let API_BASE = API_CANDIDATES[0] || 'https://api.christhelper.com';
const SITE_ORIGIN = window.location.origin.replace(/\/+$/, '');
let token = localStorage.getItem('christhelper.token');
let currentUser = JSON.parse(localStorage.getItem('christhelper.user') || 'null');

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function appPath(path = '') {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  return cleanPath ? `${SITE_ORIGIN}/${cleanPath}` : `${SITE_ORIGIN}/`;
}

function apiUrl(path = '') {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  return cleanPath ? `${API_BASE}/${cleanPath}` : API_BASE;
}


function rememberWorkingApiBase(base) {
  API_BASE = String(base || '').replace(/\/+$/, '');
  localStorage.setItem('christhelper.api', API_BASE);
}

function normalizeFetchError(error) {
  const message = String(error?.message || error || 'Request failed');
  return message === 'Failed to fetch'
    ? `Failed to fetch from ${API_BASE}. Check Frontend env, CORS, Front Door route, and DNS.`
    : message;
}

async function fetchJsonWithBase(base, path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${String(base).replace(/\/+$/, '')}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function normalizeBrowserPath() {
  const normalizedPath = window.location.pathname.replace(/\/{2,}/g, '/');
  const normalizedSearch = window.location.search || '';
  const normalizedHash = window.location.hash || '';
  const normalizedUrl = `${normalizedPath}${normalizedSearch}${normalizedHash}`;
  const currentUrl = `${window.location.pathname}${normalizedSearch}${normalizedHash}`;

  if (normalizedUrl !== currentUrl) {
    window.history.replaceState({}, '', normalizedUrl);
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(Number(value || 0));
}

function formatUsd(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function formatCurrencyByCode(value, currency) {
  const normalizedCurrency = String(currency || 'NZD').toUpperCase();
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: normalizedCurrency }).format(Number(value || 0));
}

function formatIsoDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeHtml(String(value));
  return date.toLocaleString();
}

function safeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStoredAuth(nextToken, user) {
  token = nextToken || '';
  currentUser = user || null;
  if (token) localStorage.setItem('christhelper.token', token);
  else localStorage.removeItem('christhelper.token');
  if (user) localStorage.setItem('christhelper.user', JSON.stringify(user));
  else localStorage.removeItem('christhelper.user');
}

async function api(path, options = {}) {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;

  let lastError = null;
  for (const base of API_CANDIDATES) {
    try {
      const data = await fetchJsonWithBase(base, normalizedPath, options);
      rememberWorkingApiBase(base);
      return data;
    } catch (error) {
      lastError = error;
      console.warn('API attempt failed', { base, path: normalizedPath, message: error?.message || String(error) });
    }
  }

  throw new Error(normalizeFetchError(lastError));
}

async function refreshCurrentUser() {
  if (!token) return null;
  try {
    const data = await api('/auth/me');
    setStoredAuth(token, data.user);
    setAuthUi();
    return data.user;
  } catch (error) {
    console.warn('Unable to refresh user', error.message);
    return currentUser;
  }
}

function setAuthUi() {
  document.querySelectorAll('[data-auth]').forEach(el => {
    el.classList.toggle('hide', !currentUser);
  });

  document.querySelectorAll('[data-guest]').forEach(el => {
    el.classList.toggle('hide', !!currentUser);
  });

  document.querySelectorAll('[data-admin]').forEach(el => {
    el.classList.toggle('hide', currentUser?.role !== 'admin');
  });

  const nameEl = $('#navUserName');
  if (nameEl) nameEl.textContent = currentUser ? currentUser.name : '';

  const stripeStateEls = document.querySelectorAll('[data-stripe-state]');
  stripeStateEls.forEach((el) => {
    if (!currentUser?.stripe_account_id) {
      el.textContent = 'Stripe not connected';
    } else if (currentUser?.stripe_charges_enabled) {
      el.textContent = 'Stripe ready';
    } else {
      el.textContent = 'Stripe setup pending';
    }
  });
}

function logout() {
  setStoredAuth('', null);
  window.location.href = appPath('index.html');
}

function getReplyCount(project) {
  if (typeof project.reply_count === 'number') return project.reply_count;
  if (typeof project.replyCount === 'number') return project.replyCount;
  if (typeof project.repliesCount === 'number') return project.repliesCount;
  if (typeof project.replies === 'number') return project.replies;
  if (Array.isArray(project.replies)) return project.replies.length;
  return 0;
}

function getPrayerCount(project) {
  if (typeof project.prayer_count === 'number') return project.prayer_count;
  if (typeof project.prayerCount === 'number') return project.prayerCount;
  if (typeof project.prayersCount === 'number') return project.prayersCount;
  if (typeof project.prayers === 'number') return project.prayers;
  if (Array.isArray(project.prayers)) return project.prayers.length;
  return 0;
}

function projectCard(project) {
  const pct = project.funding_goal > 0
    ? Math.min(100, Math.round((project.amount_raised / project.funding_goal) * 100))
    : 0;

  const badges = [
    project.admin_reviewed ? '<span class="badge good">Admin reviewed</span>' : '',
    project.verified_ministry ? '<span class="badge good">Verified ministry</span>' : '',
    project.needs_financial_support && !project.owner_can_receive_payments ? '<span class="badge warn">Stripe setup pending</span>' : '',
    project.urgency === 'high' ? '<span class="badge alert">Urgent</span>' : `<span class="badge warn">${safeHtml(project.urgency)}</span>`
  ].join(' ');

  const goalText = project.funding_goal_currency === 'USD'
    ? formatUsd(project.funding_goal)
    : formatMoney(project.funding_goal);

  return `
    <article class="card project-card">
      <div class="project-meta">
        <span class="badge">${safeHtml(project.country)}</span>
        <span class="badge">${safeHtml(project.continent)}</span>
        <span class="badge">${safeHtml(project.category)}</span>
      </div>
      <h3>${safeHtml(project.title)}</h3>
      <p>${safeHtml(project.summary)}</p>
      <div class="project-meta">
        ${(project.help_types || []).map(h => `<span class="badge">${safeHtml(h)}</span>`).join('')}
      </div>
      <div>${badges}</div>
      <div class="project-meta">
        <span class="badge">💬 ${getReplyCount(project)} replies</span>
        <span class="badge">🙏 ${getPrayerCount(project)} prayers</span>
      </div>
      <p><strong>Requester:</strong> ${safeHtml(project.requester_name)}${project.organization_name ? ` · ${safeHtml(project.organization_name)}` : ''}</p>
      ${project.needs_financial_support && project.funding_approved ? `
        <div class="progress-wrap">
          <div style="display:flex;justify-content:space-between;gap:12px;">
            <strong>${formatMoney(project.amount_raised)}</strong>
            <span class="muted">Goal ${goalText}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          ${project.owner_can_receive_payments ? '' : '<div class="notice" style="margin-top:12px;">This project is approved, but the owner still needs to finish Stripe onboarding before donations can open.</div>'}
        </div>
      ` : '<div class="notice">Financial support is not enabled for this project yet or this project is seeking non-financial help.</div>'}
      <div class="project-actions">
        <a class="btn" href="/project.html?id=${project.id}">View details</a>
        <a class="btn-outline" href="/project.html?id=${project.id}#pray">Pray</a>
        <a class="btn-outline" href="/project.html?id=${project.id}#reply">Reply</a>
      </div>
    </article>
  `;
}

async function loadProjects() {
  const grid = $('#projectsGrid');
  if (!grid) return;

  const params = new URLSearchParams();
  const fields = ['q', 'country', 'continent', 'category', 'helpType', 'urgency'];

  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el?.value) params.set(id, el.value);
  });

  if ($('#financialOnly')?.checked) params.set('financialOnly', '1');
  if ($('#reviewedOnly')?.checked) params.set('reviewedOnly', '1');
  if ($('#verifiedOnly')?.checked) params.set('verifiedOnly', '1');

  grid.innerHTML = '<p>Loading projects...</p>';

  try {
    const { items } = await api(`/projects?${params.toString()}`);
    if ($('#projectCount')) $('#projectCount').textContent = `${items.length} active projects`;
    grid.innerHTML = items.length
      ? items.map(projectCard).join('')
      : '<div class="card panel"><p>No projects found with these filters.</p></div>';
  } catch (error) {
    const candidates = API_CANDIDATES.map(safeHtml).join('<br>');
    grid.innerHTML = `<div class="card panel"><p>${safeHtml(error.message)}</p><p class="muted" style="margin-top:10px;">API candidates tried:</p><div class="muted">${candidates}</div></div>`;
  }
}

async function loadAllProjectsForSubmitPage() {
  const wrap = $('#allProjectsList');
  if (!wrap) return;

  wrap.innerHTML = '<p class="muted">Loading projects...</p>';

  try {
    const { items } = await api('/projects');
    wrap.innerHTML = items.length
      ? items.map(project => `
          <div class="item">
            <strong>${safeHtml(project.title)}</strong>
            <div class="muted" style="margin-top:6px;">
              ${safeHtml(project.country || '')}${project.continent ? ` · ${safeHtml(project.continent)}` : ''}${project.category ? ` · ${safeHtml(project.category)}` : ''}
            </div>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
              <span class="badge">💬 ${getReplyCount(project)} replies</span>
              <span class="badge">🙏 ${getPrayerCount(project)} prayers</span>
              <a class="btn-outline" href="/project.html?id=${project.id}">Open</a>
            </div>
          </div>
        `).join('')
      : '<p class="muted">No projects found yet.</p>';
  } catch (error) {
    wrap.innerHTML = `<p>${safeHtml(error.message)}</p>`;
  }
}

async function loadProjectDetails() {
  const root = $('#projectDetails');
  if (!root) return;

  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    root.innerHTML = '<div class="card panel"><p>Missing project id.</p></div>';
    return;
  }

  try {
    const data = await api(`/projects/${id}`);
    const { project, prayers, replies, updates, stats } = data;
    const pct = project.funding_goal > 0
      ? Math.min(100, Math.round((project.amount_raised / project.funding_goal) * 100))
      : 0;
    const donationAvailable = project.needs_financial_support && project.funding_approved && project.owner_can_receive_payments;
    const goalText = project.funding_goal_currency === 'USD'
      ? formatUsd(project.funding_goal)
      : formatMoney(project.funding_goal);

    root.innerHTML = `
      <div class="split-grid">
        <div class="stack">
          <section class="card panel">
            <div class="project-meta">
              <span class="badge">${safeHtml(project.country)}</span>
              <span class="badge">${safeHtml(project.continent)}</span>
              <span class="badge">${safeHtml(project.category)}</span>
              <span class="badge">${project.is_online ? 'Online' : safeHtml(project.city || 'Local')}</span>
            </div>
            <h1 style="font-size:2.3rem;margin-top:12px;">${safeHtml(project.title)}</h1>
            <p>${safeHtml(project.summary)}</p>
            <div class="badge-row">
              ${(project.help_types || []).map(h => `<span class="badge">${safeHtml(h)}</span>`).join('')}
              ${project.admin_reviewed ? '<span class="badge good">Admin reviewed</span>' : ''}
              ${project.verified_ministry ? '<span class="badge good">Verified church/ministry</span>' : ''}
              ${project.needs_financial_support && !project.owner_can_receive_payments ? '<span class="badge warn">Stripe onboarding still needed</span>' : ''}
            </div>
            <div class="stats-row">
              <div class="stat"><strong>${stats.prayer_count}</strong><span class="muted">Prayer supporters</span></div>
              <div class="stat"><strong>${stats.reply_count}</strong><span class="muted">Replies and offers</span></div>
              <div class="stat"><strong>${safeHtml(project.urgency)}</strong><span class="muted">Urgency</span></div>
            </div>
          </section>

          <section class="card panel">
            <h2>Project information</h2>
            <p>${safeHtml(project.description)}</p>
            <div class="list">
              <div class="item"><strong>Requester</strong>${safeHtml(project.requester_name)}</div>
              <div class="item"><strong>Church or ministry</strong>${safeHtml(project.church_ministry_linked || project.organization_name || 'Not specified')}</div>
              <div class="item"><strong>Timeline</strong>${safeHtml(project.timeline || 'Not specified')}</div>
              <div class="item"><strong>Who will benefit</strong>${safeHtml(project.who_benefits || 'Not specified')}</div>
              <div class="item"><strong>Why it matters</strong>${safeHtml(project.why_it_matters || 'Not specified')}</div>
              ${project.project_links && Array.isArray(project.project_links) && project.project_links.length ? `
                <div class="item">
                  <strong>Links</strong>
                  <div style="display:grid;gap:8px;">
                    ${project.project_links.map(link => `
                      <a href="${safeHtml(link)}" target="_blank" rel="noopener noreferrer">${safeHtml(link)}</a>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              ${project.campaign_expiry_date ? `<div class="item"><strong>Campaign expiry</strong>${safeHtml(project.campaign_expiry_date)}</div>` : ''}
            </div>
          </section>

          <section class="card panel" id="pray">
            <h2>Prayer support</h2>
            <p>Prayer is a real form of support on ChristHelper. Let the requester know you prayed.</p>
            <form id="prayForm" class="simple-form">
              <input name="name" placeholder="Your name (optional)">
              <textarea name="message" placeholder="Short encouragement or prayer note"></textarea>
              <button class="btn" type="submit">I prayed for this</button>
            </form>
            <div id="prayerList" class="list" style="margin-top:16px;">
              ${prayers.length
                ? prayers.map(item => `<div class="item"><strong>${safeHtml(item.name || 'Anonymous')}</strong>${safeHtml(item.message || '')}</div>`).join('')
                : '<p class="muted">No prayer messages yet.</p>'}
            </div>
          </section>

          <section class="card panel" id="reply">
            <h2>Reply, guidance, volunteer or mentorship</h2>
            <form id="replyForm" class="simple-form">
              <select name="type" required>
                <option value="">Select support type</option>
                <option>Guidance</option>
                <option>Volunteer</option>
                <option>Mentorship</option>
                <option>Services</option>
                <option>Encouragement</option>
              </select>
              <input name="name" placeholder="Your name" required>
              <input name="email" type="email" placeholder="Your email (optional)">
              <textarea name="message" placeholder="How would you like to help?" required></textarea>
              <button class="btn" type="submit">Send support offer</button>
            </form>
            <div id="replyList" class="list" style="margin-top:16px;">
              ${replies.length
                ? replies.map(item => `<div class="item"><strong>${safeHtml(item.type)} · ${safeHtml(item.name)}</strong>${safeHtml(item.message)}</div>`).join('')
                : '<p class="muted">No replies yet.</p>'}
            </div>
          </section>

          <section class="card panel">
            <h2>Project updates</h2>
            <div class="list">
              ${updates.length
                ? updates.map(item => `<div class="item"><strong>${safeHtml(item.title)}</strong>${safeHtml(item.content)}<div class="muted" style="margin-top:8px;">${new Date(item.created_at).toLocaleString()}</div></div>`).join('')
                : '<p class="muted">No updates yet.</p>'}
            </div>
          </section>
        </div>

        <aside class="stack">
          <section class="card panel">
            <h2>Support this project</h2>
            <div class="notice">ChristHelper reviews financial requests before enabling payments, but users should still use prayer, wisdom, and personal judgment before giving.</div>
            ${project.needs_financial_support && project.funding_approved ? `
              <div class="progress-wrap" style="margin-top:14px;">
                <div style="display:flex;justify-content:space-between;gap:12px;">
                  <strong>${formatMoney(project.amount_raised)}</strong>
                  <span class="muted">Goal ${goalText}</span>
                </div>
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
              </div>
              ${donationAvailable ? `
                <div class="notice" style="margin-top:16px;">Payments for financial support are processed in USD. Stripe transaction fees apply per payment, so the amount paid by the supporter and the net amount received by the project owner may be different.</div>
                <form id="projectDonationForm" class="simple-form" style="margin-top:16px;">
                  <input name="donor_name" placeholder="Your name">
                  <input name="donor_email" type="email" placeholder="Your email">
                  <input name="amount_project" type="number" min="1" step="0.01" placeholder="Amount for this project (USD)" required>
                  <input name="amount_platform" type="number" min="0" step="0.01" placeholder="Optional support for ChristHelper (USD)">
                  <button class="btn" type="submit">Continue to secure payment</button>
                </form>
              ` : '<p class="muted" style="margin-top:14px;">This project is approved, but the owner still needs to finish Stripe onboarding before donations can be accepted.</p>'}
            ` : '<p class="muted">Financial support is not available yet for this project. You can still pray, reply, volunteer, and encourage.</p>'}
          </section>

          <section class="card panel">
            <h3>Report project</h3>
            <form id="reportForm" class="simple-form">
              <select name="reason" required>
                <option value="">Select reason</option>
                <option>Suspicious or misleading request</option>
                <option>False information</option>
                <option>Inappropriate content</option>
                <option>Other safety concern</option>
              </select>
              <textarea name="details" placeholder="Extra details"></textarea>
              <button class="btn-outline" type="submit">Submit report</button>
            </form>
          </section>
        </aside>
      </div>
    `;

    $('#prayForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/projects/${id}/pray`, { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
        alert('Prayer support recorded. Thank you.');
        location.reload();
      } catch (error) {
        alert(error.message);
      }
    });

    $('#replyForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/projects/${id}/reply`, { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
        alert('Your support offer has been sent.');
        location.reload();
      } catch (error) {
        alert(error.message);
      }
    });

    $('#reportForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/projects/${id}/report`, { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
        alert('Thank you. The report was submitted.');
        e.target.reset();
      } catch (error) {
        alert(error.message);
      }
    });

    $('#projectDonationForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        const data = await api('/payments/project-checkout', {
          method: 'POST',
          body: JSON.stringify({ ...fd, project_id: id })
        });
        if (data.url) {
          window.location.href = data.url;
        } else {
          alert(data.message || 'Donation recorded in demo mode.');
        }
      } catch (error) {
        alert(error.message);
      }
    });
  } catch (error) {
    root.innerHTML = `<div class="card panel"><p>${safeHtml(error.message)}</p></div>`;
  }
}

function handleAuthForms() {
  const registerForm = $('#registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(registerForm));
      try {
        const data = await api('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
        setStoredAuth(data.token, data.user);
        window.location.href = appPath('profile.html');
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const loginForm = $('#loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(loginForm));
      try {
        const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
        setStoredAuth(data.token, data.user);
        window.location.href = appPath('profile.html');
      } catch (error) {
        alert(error.message);
      }
    });
  }
}

/* =========================
   SUBMIT PAGE HELPERS
========================= */

const COUNTRY_ISO_CODES = (
  "AF,AX,AL,DZ,AS,AD,AO,AI,AQ,AG,AR,AM,AW,AU,AT,AZ,BS,BH,BD,BB,BY,BE,BZ,BJ" +
  ",BM,BT,BO,BQ,BA,BW,BV,BR,IO,BN,BG,BF,BI,KH,CM,CA,CV,KY,CF,TD,CL,CN,CX,CC,CO,KM,CG,CD" +
  ",CK,CR,CI,HR,CU,CW,CY,CZ,DK,DJ,DM,DO,EC,EG,SV,GQ,ER,EE,SZ,ET,FK,FO,FJ,FI,FR,GF,PF,TF" +
  ",GA,GM,GE,DE,GH,GI,GR,GL,GD,GP,GU,GT,GG,GN,GW,GY,HT,HM,VA,HN,HK,HU,IS,IN,ID,IR,IQ,IE" +
  ",IM,IL,IT,JM,JP,JE,JO,KZ,KE,KI,KP,KR,KW,KG,LA,LV,LB,LS,LR,LY,LI,LT,LU,MO,MG,MW,MY,MV" +
  ",ML,MT,MH,MQ,MR,MU,YT,MX,FM,MD,MC,MN,ME,MS,MA,MZ,MM,NA,NR,NP,NL,NC,NZ,NI,NE,NG,NU,NF" +
  ",MK,MP,NO,OM,PK,PW,PS,PA,PG,PY,PE,PH,PN,PL,PT,PR,QA,RE,RO,RU,RW,BL,SH,KN,LC,MF,PM,VC" +
  ",WS,SM,ST,SA,SN,RS,SC,SL,SG,SX,SK,SI,SB,SO,ZA,GS,SS,ES,LK,SD,SR,SJ,SE,CH,SY,TW,TJ,TZ" +
  ",TH,TL,TG,TK,TO,TT,TN,TR,TM,TC,TV,UG,UA,AE,GB,US,UM,UY,UZ,VU,VE,VN,VG,VI,WF,EH,YE,ZM,ZW"
).split(',');

const CONTINENT_CODE_GROUPS = {
  Africa: "DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW".split(' '),
  Antarctica: "AQ BV TF HM GS".split(' '),
  Asia: "AF AM AZ BH BD BT IO BN KH CN CX CC CY GE HK IN ID IR IQ IL JP JO KZ KP KR KW KG LA LB MO MY MV MN MM NP OM PK PS PH QA SA SG LK SY TW TJ TH TL TR TM AE UZ VN YE".split(' '),
  Europe: "AX AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA".split(' '),
  NorthAmerica: "AI AG AW BS BB BZ BM BQ KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TC TT US UM VG VI CA".split(' '),
  Oceania: "AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF".split(' '),
  SouthAmerica: "AR BO BR CL CO EC FK GF GY PY PE SR UY VE".split(' ')
};

const COUNTRY_CONTINENT_MAP = Object.entries(CONTINENT_CODE_GROUPS).reduce((acc, [continentKey, codes]) => {
  const continentName = continentKey
    .replace('NorthAmerica', 'North America')
    .replace('SouthAmerica', 'South America');

  codes.forEach((code) => {
    acc[code] = continentName;
  });

  return acc;
}, {});

let COUNTRY_OPTIONS = [];
let COUNTRY_NAME_TO_META = {};

function buildCountryDropdown() {
  const el = document.getElementById('projectCountry') || document.querySelector('[name="country"]');
  if (!el) return;

  const currentValue = el.value;
  const displayNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

  COUNTRY_OPTIONS = COUNTRY_ISO_CODES
    .map((code) => ({
      code,
      name: displayNames?.of(code) || code,
      continent: COUNTRY_CONTINENT_MAP[code] || ''
    }))
    .filter((item) => item.name)
    .filter((item, index, arr) => arr.findIndex((entry) => entry.name === item.name) === index)
    .sort((a, b) => a.name.localeCompare(b.name));

  COUNTRY_NAME_TO_META = COUNTRY_OPTIONS.reduce((acc, item) => {
    acc[item.name] = item;
    return acc;
  }, {});

  el.innerHTML =
    '<option value="">-- Select country --</option>' +
    COUNTRY_OPTIONS.map((item) => `
      <option value="${safeHtml(item.name)}" data-code="${safeHtml(item.code)}" data-continent="${safeHtml(item.continent)}">
        ${safeHtml(item.name)}
      </option>
    `).join('');

  if (currentValue && COUNTRY_NAME_TO_META[currentValue]) {
    el.value = currentValue;
  }
}

function normalizeCountryName(value) {
  return String(value || '').trim();
}

function detectContinentFromCountry(country) {
  const normalized = normalizeCountryName(country);
  if (!normalized) return '';

  return COUNTRY_NAME_TO_META[normalized]?.continent || '';
}

function fillContinentFromCountry() {
  const countryEl = document.getElementById('projectCountry') || document.querySelector('[name="country"]');
  const continentEl = document.getElementById('projectContinent') || document.querySelector('[name="continent"]');
  if (!countryEl || !continentEl) return;

  const selectedOption = countryEl.selectedOptions?.[0];
  const continent = selectedOption?.dataset?.continent || detectContinentFromCountry(countryEl.value);
  continentEl.value = continent || '';
}

function toggleFinancialFields() {
  const needsFinancial = $('#needsFinancialSupport') || $('[name="needs_financial_support"]');
  const goalWrap = $('#financialGoalWrap');
  const expiryWrap = $('#campaignExpiryWrap');
  const goalInput = $('#fundingGoal') || $('[name="funding_goal"]');
  const currencyInput = $('#fundingGoalCurrency') || $('[name="funding_goal_currency"]');
  const expiryInput = $('#campaignExpiryDate') || $('[name="campaign_expiry_date"]');

  const isChecked = Boolean(needsFinancial?.checked);

  if (goalWrap) goalWrap.classList.toggle('hide', !isChecked);
  if (expiryWrap) expiryWrap.classList.toggle('hide', !isChecked);

  if (currencyInput) currencyInput.value = isChecked ? 'USD' : '';

  if (goalInput) {
    goalInput.required = isChecked;
    if (!isChecked) goalInput.value = '';
  }

  if (expiryInput) {
    expiryInput.required = isChecked;
    if (!isChecked) expiryInput.value = '';
  }
}

function parseProjectLinks(rawValue) {
  return String(rawValue || '')
    .split(/\n|,/) 
    .map(item => item.trim())
    .filter(Boolean);
}

function renderSubmitInfoIcons() {
  const infoEls = $all('[data-info]');
  infoEls.forEach((el) => {
    const text = el.getAttribute('data-info');
    if (!text) return;

    if (el.querySelector('.info-help')) return;

    const span = document.createElement('span');
    span.className = 'info-help';
    span.title = text;
    span.setAttribute('aria-label', text);
    span.textContent = 'ⓘ';
    span.style.marginLeft = '6px';
    span.style.cursor = 'help';
    span.style.color = 'var(--primary)';
    span.style.fontWeight = '700';
    el.appendChild(span);
  });
}

function setSubmitMinDate() {
  const expiryInput = $('#campaignExpiryDate') || $('[name="campaign_expiry_date"]');
  if (!expiryInput) return;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  expiryInput.min = `${yyyy}-${mm}-${dd}`;
}

function handleSubmitProject() {
  const form = $('#submitProjectForm');
  if (!form) return;

  buildCountryDropdown();
  renderSubmitInfoIcons();
  fillContinentFromCountry();
  toggleFinancialFields();
  setSubmitMinDate();
  loadAllProjectsForSubmitPage();

  const countryEl = $('#projectCountry') || $('[name="country"]');
  countryEl?.addEventListener('change', fillContinentFromCountry);
  countryEl?.addEventListener('blur', fillContinentFromCountry);

  const needsFinancialEl = $('#needsFinancialSupport') || $('[name="needs_financial_support"]');
  needsFinancialEl?.addEventListener('change', toggleFinancialFields);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd);

    payload.is_online = fd.get('is_online') === 'on';
    payload.needs_financial_support = fd.get('needs_financial_support') === 'on';
    payload.help_types = fd.getAll('help_types');
    payload.project_links = parseProjectLinks(payload.project_links);
    payload.continent = payload.continent || detectContinentFromCountry(payload.country);

    if (payload.needs_financial_support) {
      payload.funding_goal_currency = 'USD';

      if (!currentUser?.stripe_account_id) {
        alert('Please connect Stripe in your profile before submitting a project that needs financial support.');
        window.location.href = appPath('profile.html');
        return;
      }

      if (!currentUser?.stripe_charges_enabled) {
        alert('Your Stripe account is connected, but setup is not finished yet. Please finish Stripe onboarding in your profile before submitting a financial project.');
        window.location.href = appPath('profile.html');
        return;
      }

      if (!payload.funding_goal || Number(payload.funding_goal) <= 0) {
        alert('Please enter a funding goal in USD.');
        return;
      }

      if (!payload.campaign_expiry_date) {
        alert('Please set a campaign expiry date.');
        return;
      }
    } else {
      payload.funding_goal = payload.funding_goal || 0;
      payload.funding_goal_currency = '';
      payload.campaign_expiry_date = '';
    }

    try {
      await api('/projects', { method: 'POST', body: JSON.stringify(payload) });
      alert(payload.needs_financial_support
        ? 'Project submitted successfully. Because Stripe is ready, your financial request can move to admin review.'
        : 'Project submitted successfully.');
      form.reset();
      buildCountryDropdown();
      fillContinentFromCountry();
      toggleFinancialFields();
      window.location.href = appPath('profile.html');
    } catch (error) {
      alert(error.message.includes('Missing token') ? 'Please login first to submit a project.' : error.message);
    }
  });
}

function handlePlatformDonation() {
  const form = $('#platformDonationForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    try {
      const data = await api('/payments/platform-checkout', { method: 'POST', body: JSON.stringify(payload) });
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.message || 'Donation recorded in demo mode.');
      }
    } catch (error) {
      alert(error.message);
    }
  });
}

function getProfileFieldValue(source, ...keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) return source[key];
  }
  return '';
}


function renderStripeSummarySection(summary, options = {}) {
  const stripeConnected = Boolean(options.stripeConnected);
  const stripeReady = Boolean(options.stripeReady);

  if (!stripeConnected) {
    return `
      <section class="card panel">
        <h2>Stripe earnings</h2>
        <p class="muted">Connect Stripe first to view your balance, recent transactions, and payouts.</p>
      </section>
    `;
  }

  if (!summary) {
    return `
      <section class="card panel">
        <h2>Stripe earnings</h2>
        <p class="muted">${stripeReady ? 'Loading Stripe balance and recent activity...' : 'Finish Stripe onboarding to unlock your Stripe earnings view.'}</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;">
          <button class="btn" id="openStripeDashboardBtn" type="button">Open Stripe dashboard</button>
          <button class="btn-outline" id="refreshStripeSummaryBtn" type="button">Refresh earnings</button>
        </div>
      </section>
    `;
  }

  const balance = summary.balance || {};
  const account = summary.account || {};
  const local = summary.local_summary || {};
  const recentTransactions = Array.isArray(summary.recent_transactions) ? summary.recent_transactions : [];
  const payouts = Array.isArray(summary.payouts) ? summary.payouts : [];
  const recentDonations = Array.isArray(local.recent_donations) ? local.recent_donations : [];
  const currency = balance.currency || local.currency || account.default_currency || 'NZD';

  return `
    <section class="card panel">
      <h2>Stripe earnings</h2>
      <p class="muted">This section shows your Stripe connected account balance plus recent donation records from ChristHelper.</p>

      <div class="stats-grid stripe-summary-grid">
        <div class="stat">
          <strong>${formatCurrencyByCode(balance.available || 0, currency)}</strong>
          <span class="muted">Available balance</span>
        </div>
        <div class="stat">
          <strong>${formatCurrencyByCode(balance.pending || 0, currency)}</strong>
          <span class="muted">Pending balance</span>
        </div>
        <div class="stat">
          <strong>${formatCurrencyByCode(local.total_received || 0, local.currency || currency)}</strong>
          <span class="muted">Received on ChristHelper</span>
        </div>
      </div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;">
        <button class="btn" id="openStripeDashboardBtn" type="button">Open Stripe dashboard</button>
        <button class="btn-outline" id="refreshStripeSummaryBtn" type="button">Refresh earnings</button>
      </div>

      <div class="notice" style="margin-top:16px;">
        In test mode Stripe Express access uses a one-time login link. Use the dashboard button each time you want to open Stripe.
      </div>

      <div class="list" style="margin-top:16px;">
        <div class="item"><strong>Stripe account</strong>${safeHtml(account.id || 'Not connected')}</div>
        <div class="item"><strong>Charges enabled</strong>${account.charges_enabled ? 'Yes' : 'No'}</div>
        <div class="item"><strong>Payouts enabled</strong>${account.payouts_enabled ? 'Yes' : 'No'}</div>
      </div>

      <div class="table-wrap" style="margin-top:18px;">
        <h3 style="margin-bottom:10px;">Recent Stripe transactions</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Net</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${recentTransactions.length
              ? recentTransactions.map((item) => `
                <tr>
                  <td>${safeHtml(formatIsoDateTime(item.created))}</td>
                  <td>${safeHtml(item.description || item.type || 'Transaction')}</td>
                  <td>${safeHtml(formatCurrencyByCode(item.net || 0, item.currency || currency))}</td>
                  <td>${safeHtml(item.status || '—')}</td>
                </tr>
              `).join('')
              : '<tr><td colspan="4">No Stripe transactions found yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="table-wrap" style="margin-top:18px;">
        <h3 style="margin-bottom:10px;">Recent payouts</h3>
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Arrival</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${payouts.length
              ? payouts.map((item) => `
                <tr>
                  <td>${safeHtml(formatIsoDateTime(item.created))}</td>
                  <td>${safeHtml(formatIsoDateTime(item.arrival_date))}</td>
                  <td>${safeHtml(formatCurrencyByCode(item.amount || 0, item.currency || currency))}</td>
                  <td>${safeHtml(item.status || '—')}</td>
                </tr>
              `).join('')
              : '<tr><td colspan="4">No payouts found yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="table-wrap" style="margin-top:18px;">
        <h3 style="margin-bottom:10px;">Recent ChristHelper donations</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Donor</th>
              <th>Project amount</th>
              <th>Payment intent</th>
            </tr>
          </thead>
          <tbody>
            ${recentDonations.length
              ? recentDonations.map((item) => `
                <tr>
                  <td>${safeHtml(formatIsoDateTime(item.processed_at || item.created_at))}</td>
                  <td>${safeHtml(item.donor_name || 'Anonymous')}</td>
                  <td>${safeHtml(formatCurrencyByCode(item.amount_project || 0, item.currency || currency))}</td>
                  <td>${safeHtml(item.stripe_payment_intent_id || '—')}</td>
                </tr>
              `).join('')
              : '<tr><td colspan="4">No paid donations recorded yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

async function openStripeDashboard() {
  try {
    const data = await api('/stripe/connect/dashboard-link');
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    alert('Unable to open Stripe dashboard.');
  } catch (error) {
    alert(error.message || 'Unable to open Stripe dashboard.');
  }
}

function normalizeProfilePreferences(user) {
  return {
    show_email_publicly: Boolean(user?.show_email_publicly),
    allow_financial_support: user?.allow_financial_support !== false,
    allow_prayer_requests: user?.allow_prayer_requests !== false,
    allow_replies: user?.allow_replies !== false,
    hide_archived_projects: Boolean(user?.hide_archived_projects),
    exclude_closed_projects: Boolean(user?.exclude_closed_projects)
  };
}

function profileProjectStatus(project) {
  if (project.excluded || project.is_excluded) return 'excluded';
  if (project.archived || project.is_archived) return 'archived';
  if (project.status === 'draft') return 'draft';
  return 'active';
}

function renderProfileProjectList(projects, filter = 'all') {
  const list = $('#profileProjectsList');
  if (!list) return;

  const items = (projects || []).filter((project) => {
    if (filter === 'all') return true;
    return profileProjectStatus(project) === filter;
  });

  list.innerHTML = items.length
    ? items.map(project => {
        const status = profileProjectStatus(project);
        return `
          <div class="item">
            <strong>${safeHtml(project.title)}</strong>
            <div class="muted" style="margin-top:6px;">${safeHtml(project.summary || '')}</div>

            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
              <span class="badge">${safeHtml(status)}</span>
              <span class="badge">${project.admin_reviewed ? 'Reviewed' : 'Pending review'}</span>
              ${project.needs_financial_support
                ? `<span class="badge">${project.funding_approved ? 'Financial approved' : 'Financial pending'}</span>`
                : '<span class="badge">No financial support</span>'}
              ${project.owner_can_receive_payments
                ? '<span class="badge good">Stripe ready</span>'
                : '<span class="badge warn">Stripe pending</span>'}
              <span class="badge">💬 ${getReplyCount(project)} replies</span>
              <span class="badge">🙏 ${getPrayerCount(project)} prayers</span>
            </div>

            <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
              <a class="btn-outline" href="/project.html?id=${project.id}">View</a>
              ${status !== 'archived' ? `<button class="btn-outline" type="button" data-project-action="archive" data-project-id="${project.id}">Archive</button>` : ''}
              ${status === 'archived' ? `<button class="btn-outline" type="button" data-project-action="restore" data-project-id="${project.id}">Restore</button>` : ''}
              ${status !== 'excluded' ? `<button class="btn-outline" type="button" data-project-action="exclude" data-project-id="${project.id}">Exclude</button>` : ''}
              ${status === 'excluded' ? `<button class="btn-outline" type="button" data-project-action="include" data-project-id="${project.id}">Include</button>` : ''}
            </div>
          </div>
        `;
      }).join('')
    : '<p class="muted">No projects in this section.</p>';
}

async function tryProfileAction(path, body, fallbackMessage) {
  try {
    return await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
  } catch (error) {
    if (fallbackMessage) alert(fallbackMessage);
    else alert(error.message);
    return null;
  }
}

function attachProfileProjectActions(projectsRef) {
  $all('[data-project-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-project-id');
      const action = btn.getAttribute('data-project-action');

      if (!id || !action) return;

      let handled = false;

      if (action === 'archive') {
        const result = await tryProfileAction(`/projects/${id}/archive`, {}, 'Archive endpoint is not ready in the backend yet.');
        handled = Boolean(result);
      }

      if (action === 'restore') {
        const result = await tryProfileAction(`/projects/${id}/restore`, {}, 'Restore endpoint is not ready in the backend yet.');
        handled = Boolean(result);
      }

      if (action === 'exclude') {
        const result = await tryProfileAction(`/projects/${id}/exclude`, {}, 'Exclude endpoint is not ready in the backend yet.');
        handled = Boolean(result);
      }

      if (action === 'include') {
        const result = await tryProfileAction(`/projects/${id}/include`, {}, 'Include endpoint is not ready in the backend yet.');
        handled = Boolean(result);
      }

      if (handled) {
        await handleProfilePage();
      }
    });
  });
}

async function handleProfilePage() {
  const root = $('#profilePage');
  if (!root) return;

  if (!token) {
    root.innerHTML = '<section class="card page-card"><h1>Your profile</h1><p>Please sign in first.</p><p><a class="btn" href="/login.html">Sign in</a></p></section>';
    return;
  }

  root.innerHTML = '<section class="card page-card"><p>Loading profile...</p></section>';

  try {
    const [{ user, projects }, stripeStatus, stripeSummary] = await Promise.all([
      api('/profile'),
      api('/stripe/connect/status').catch(() => ({ configured: false, user: currentUser })),
      api('/stripe/connect/summary').catch(() => null)
    ]);

    const mergedUser = { ...user, ...(stripeStatus?.user || {}) };
    setStoredAuth(token, mergedUser);
    setAuthUi();

    const stripeReady = Boolean(mergedUser?.stripe_charges_enabled);
    const stripeConnected = Boolean(mergedUser?.stripe_account_id);

    const prefs = normalizeProfilePreferences(mergedUser);

    root.innerHTML = `
      <section class="card page-card">
        <div class="eyebrow">My profile</div>
        <h1 style="font-size:2.3rem;">Welcome, ${safeHtml(mergedUser?.name || '')}</h1>
        <p>Manage your account details, Stripe connection, and project preferences.</p>

        <div class="split-grid" style="align-items:start;">
          <div class="stack">
            <section class="card panel">
              <h2>Personal details</h2>
              <div class="form-grid">
                <label class="field">
                  <span>Name</span>
                  <input type="text" id="profileName" value="${safeHtml(getProfileFieldValue(mergedUser, 'name'))}" placeholder="Your full name">
                </label>

                <label class="field">
                  <span>Email</span>
                  <input type="email" id="profileEmail" value="${safeHtml(getProfileFieldValue(mergedUser, 'email'))}" placeholder="you@example.com">
                </label>

                <label class="field">
                  <span>Country</span>
                  <input type="text" id="profileCountry" value="${safeHtml(getProfileFieldValue(mergedUser, 'country'))}" placeholder="New Zealand">
                </label>

                <label class="field">
                  <span>Church / Organisation</span>
                  <input type="text" id="profileOrganisation" value="${safeHtml(getProfileFieldValue(mergedUser, 'organization_name', 'organisation_name', 'church_name'))}" placeholder="Optional">
                </label>
              </div>

              <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;">
                <button class="btn" id="saveProfileBtn" type="button">Save profile</button>
              </div>
            </section>

            <section class="card panel">
              <h2>Stripe payouts</h2>
              <p>${stripeReady
                ? 'Stripe connected and ready to receive financial support.'
                : stripeConnected
                  ? 'Stripe account connected, but onboarding is not finished yet.'
                  : 'Stripe is not connected yet.'}</p>

              <div class="list">
                <div class="item"><strong>Account email</strong>${safeHtml(mergedUser?.email || '')}</div>
                <div class="item"><strong>Stripe account</strong>${stripeConnected ? safeHtml(mergedUser?.stripe_account_id) : 'Not connected'}</div>
                <div class="item"><strong>Charges enabled</strong>${stripeReady ? 'Yes' : 'No'}</div>
                <div class="item"><strong>Payouts enabled</strong>${mergedUser?.stripe_payouts_enabled ? 'Yes' : 'No'}</div>
              </div>

              <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;">
                <button class="btn" id="connectStripeBtn" type="button">${stripeConnected ? 'Continue Stripe setup' : 'Connect with Stripe'}</button>
                <button class="btn-outline" id="refreshStripeBtn" type="button">Refresh status</button>
                <button class="btn-outline" id="disconnectStripeBtn" type="button">Disconnect Stripe</button>
              </div>

              <div class="notice" style="margin-top:16px;">
                For financial projects, the flow is: create project → admin approves financial support → your Stripe account is ready → donations open.
              </div>
            </section>

            <section class="card panel">
              <h2>Preferences</h2>
              <div class="form-grid">
                <label class="checkbox-field">
                  <input type="checkbox" id="showEmailPublicly" ${prefs.show_email_publicly ? 'checked' : ''}>
                  <span>Show my email publicly on projects</span>
                </label>

                <label class="checkbox-field">
                  <input type="checkbox" id="allowFinancialSupport" ${prefs.allow_financial_support ? 'checked' : ''}>
                  <span>Allow financial support on my approved projects</span>
                </label>

                <label class="checkbox-field">
                  <input type="checkbox" id="allowPrayerRequests" ${prefs.allow_prayer_requests ? 'checked' : ''}>
                  <span>Allow prayer support and prayer counters</span>
                </label>

                <label class="checkbox-field">
                  <input type="checkbox" id="allowReplies" ${prefs.allow_replies ? 'checked' : ''}>
                  <span>Allow public replies and encouragement messages</span>
                </label>

                <label class="checkbox-field">
                  <input type="checkbox" id="hideArchivedProjects" ${prefs.hide_archived_projects ? 'checked' : ''}>
                  <span>Hide archived projects from my public profile</span>
                </label>

                <label class="checkbox-field">
                  <input type="checkbox" id="excludeClosedProjects" ${prefs.exclude_closed_projects ? 'checked' : ''}>
                  <span>Exclude completed / closed projects from public listings</span>
                </label>
              </div>

              <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;">
                <button class="btn" id="savePreferencesBtn" type="button">Save preferences</button>
              </div>
            </section>
          </div>

          <div class="stack">
            ${renderStripeSummarySection(stripeSummary, { stripeConnected, stripeReady })}
            <section class="card panel">
              <h2>My projects</h2>
              <p class="muted">Projects you submitted on ChristHelper.</p>

              <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 16px;">
                <button class="btn-outline" type="button" data-project-filter="all">All</button>
                <button class="btn-outline" type="button" data-project-filter="active">Active</button>
                <button class="btn-outline" type="button" data-project-filter="draft">Drafts</button>
                <button class="btn-outline" type="button" data-project-filter="archived">Archived</button>
                <button class="btn-outline" type="button" data-project-filter="excluded">Excluded</button>
              </div>

              <div id="profileProjectsList" class="list"></div>

              <div style="margin-top:16px;">
                <a class="btn" href="/submit.html">Submit new project</a>
              </div>
            </section>

            <section class="card panel">
              <h2>Account actions</h2>
              <div style="display:flex;gap:12px;flex-wrap:wrap;">
                <button class="btn-outline" id="downloadDataBtn" type="button">Download my data</button>
                <button class="btn-outline" id="changePasswordBtn" type="button">Change password</button>
                <button class="btn-outline" id="deactivateAccountBtn" type="button">Deactivate account</button>
              </div>
            </section>
          </div>
        </div>
      </section>
    `;

    let activeProjectFilter = 'all';
    renderProfileProjectList(projects, activeProjectFilter);
    attachProfileProjectActions(projects);

    $all('[data-project-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeProjectFilter = btn.getAttribute('data-project-filter') || 'all';
        renderProfileProjectList(projects, activeProjectFilter);
        attachProfileProjectActions(projects);
      });
    });

    $('#saveProfileBtn')?.addEventListener('click', async () => {
      const payload = {
        name: $('#profileName')?.value?.trim() || '',
        email: $('#profileEmail')?.value?.trim() || '',
        country: $('#profileCountry')?.value?.trim() || '',
        organization_name: $('#profileOrganisation')?.value?.trim() || ''
      };

      try {
        const data = await api('/profile/update', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        if (data?.user) {
          setStoredAuth(token, data.user);
          setAuthUi();
        }
        alert('Profile updated successfully.');
      } catch (error) {
        alert(error.message || 'Profile update endpoint is not ready yet.');
      }
    });

    $('#savePreferencesBtn')?.addEventListener('click', async () => {
      const payload = {
        show_email_publicly: $('#showEmailPublicly')?.checked || false,
        allow_financial_support: $('#allowFinancialSupport')?.checked || false,
        allow_prayer_requests: $('#allowPrayerRequests')?.checked || false,
        allow_replies: $('#allowReplies')?.checked || false,
        hide_archived_projects: $('#hideArchivedProjects')?.checked || false,
        exclude_closed_projects: $('#excludeClosedProjects')?.checked || false
      };

      try {
        const data = await api('/profile/preferences', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        if (data?.user) {
          setStoredAuth(token, data.user);
          setAuthUi();
        }
        alert('Preferences saved successfully.');
      } catch (error) {
        alert(error.message || 'Preferences endpoint is not ready yet.');
      }
    });

    $('#connectStripeBtn')?.addEventListener('click', async () => {
      try {
        const data = await api('/stripe/connect/onboard', {
          method: 'POST',
          body: JSON.stringify({
            refresh_url: appPath('profile.html?stripe=refresh'),
            return_url: appPath('profile.html?stripe=return')
          })
        });

        if (data.url) window.location.href = data.url;
      } catch (error) {
        alert(error.message);
      }
    });

    $('#refreshStripeBtn')?.addEventListener('click', async () => {
      try {
        await refreshCurrentUser();
        location.reload();
      } catch (error) {
        alert(error.message);
      }
    });

    $('#openStripeDashboardBtn')?.addEventListener('click', openStripeDashboard);
    $('#refreshStripeSummaryBtn')?.addEventListener('click', async () => {
      try {
        await refreshCurrentUser();
        await handleProfilePage();
      } catch (error) {
        alert(error.message || 'Unable to refresh Stripe earnings.');
      }
    });

    $('#disconnectStripeBtn')?.addEventListener('click', async () => {
      const ok = window.confirm('Are you sure you want to disconnect Stripe from your profile?');
      if (!ok) return;

      try {
        const data = await api('/stripe/connect/disconnect', {
          method: 'POST',
          body: JSON.stringify({})
        });

        if (data?.user) {
          setStoredAuth(token, data.user);
          setAuthUi();
        }
        alert('Stripe account disconnected.');
        location.reload();
      } catch (error) {
        alert(error.message || 'Disconnect Stripe endpoint is not ready yet.');
      }
    });

    $('#downloadDataBtn')?.addEventListener('click', async () => {
      try {
        const data = await api('/profile/export');
        if (data?.url) {
          window.location.href = data.url;
          return;
        }
        alert('Export ready.');
      } catch (error) {
        alert(error.message || 'Data export endpoint is not ready yet.');
      }
    });

    $('#changePasswordBtn')?.addEventListener('click', () => {
      alert('Change password flow can be added next. If you want, I can update the backend and login flow for it.');
    });

    $('#deactivateAccountBtn')?.addEventListener('click', async () => {
      const ok = window.confirm('Are you sure you want to deactivate your account?');
      if (!ok) return;

      try {
        await api('/profile/deactivate', {
          method: 'POST',
          body: JSON.stringify({})
        });
        alert('Your account has been deactivated.');
        logout();
      } catch (error) {
        alert(error.message || 'Deactivate account endpoint is not ready yet.');
      }
    });
  } catch (error) {
    root.innerHTML = `<section class="card page-card"><p>${safeHtml(error.message)}</p></section>`;
  }
}


let adminProjectsCache = [];
let adminDonationsCache = [];

function getAdminFundingStatus(project) {
  if (!project?.needs_financial_support) return 'Not applied';
  if (project?.financial_denied) return 'Denied';
  if (project?.funding_approved) return 'Approved';
  return 'Pending';
}

function getAdminProjectStatusBadge(project) {
  const status = String(project?.status || 'active');
  if (status === 'cancelled') return '<span class="badge alert">Cancelled</span>';
  if (status === 'archived') return '<span class="badge warn">Archived</span>';
  if (status === 'inactive') return '<span class="badge warn">Inactive</span>';
  return '<span class="badge good">Active</span>';
}

function getAdminReviewedBadge(project) {
  return project?.admin_reviewed
    ? '<span class="badge good">Reviewed</span>'
    : '<span class="badge warn">No</span>';
}

function getAdminFundingBadge(project) {
  const status = getAdminFundingStatus(project);
  if (status === 'Approved') return '<span class="badge good">Approved</span>';
  if (status === 'Denied') return '<span class="badge alert">Denied</span>';
  if (status === 'Not applied') return '<span class="badge">Not applied</span>';
  return '<span class="badge warn">Pending</span>';
}

function matchesAdminFilters(project) {
  const title = ($('#adminFilterTitle')?.value || '').trim().toLowerCase();
  const requester = ($('#adminFilterRequester')?.value || '').trim().toLowerCase();
  const status = $('#adminFilterStatus')?.value || '';
  const financial = $('#adminFilterFinancial')?.value || '';
  const fundingStatus = $('#adminFilterFundingStatus')?.value || '';
  const reviewed = $('#adminFilterReviewed')?.value || '';

  if (title && !String(project.title || '').toLowerCase().includes(title)) return false;
  if (requester && !String(project.requester_name || '').toLowerCase().includes(requester)) return false;
  if (status && String(project.status || 'active') !== status) return false;
  if (financial === 'yes' && !project.needs_financial_support) return false;
  if (financial === 'no' && project.needs_financial_support) return false;

  const normalizedFundingStatus = getAdminFundingStatus(project).toLowerCase().replace(/\s+/g, '_');
  if (fundingStatus && normalizedFundingStatus !== fundingStatus) return false;

  if (reviewed === 'yes' && !project.admin_reviewed) return false;
  if (reviewed === 'no' && project.admin_reviewed) return false;

  return true;
}

function renderAdminProjects(items) {
  const table = $('#adminProjectsTable');
  if (!table) return;

  const filtered = (items || []).filter(matchesAdminFilters);
  const countEl = $('#adminProjectsCount');
  if (countEl) countEl.textContent = `${filtered.length} project${filtered.length === 1 ? '' : 's'}`;

  if (!filtered.length) {
    table.innerHTML = '<tr><td colspan="8">No projects found with these filters.</td></tr>';
    return;
  }

  table.innerHTML = filtered.map(item => `
    <tr>
      <td>${safeHtml(item.id)}</td>
      <td>
        <strong>${safeHtml(item.title)}</strong>
        ${item.cancellation_reason ? `<div class="muted" style="margin-top:6px;">Cancelled: ${safeHtml(item.cancellation_reason)}</div>` : ''}
        ${item.denied_reason ? `<div class="muted" style="margin-top:6px;">Denied: ${safeHtml(item.denied_reason)}</div>` : ''}
      </td>
      <td>${safeHtml(item.requester_name)}</td>
      <td>${getAdminProjectStatusBadge(item)}</td>
      <td>${item.needs_financial_support ? 'Yes' : 'No'}</td>
      <td>${getAdminFundingBadge(item)}</td>
      <td>${getAdminReviewedBadge(item)}</td>
      <td>
        <div class="admin-actions">
          <input
            type="text"
            class="admin-reason-input"
            id="adminReason-${safeHtml(item.id)}"
            placeholder="Optional reason"
            value="${safeHtml(item.status === 'cancelled' ? (item.cancellation_reason || '') : (item.denied_reason || ''))}"
          >
          <div class="admin-actions-row">
            ${item.needs_financial_support ? `<button class="btn-outline btn-xs" onclick="approveProject('${item.id}')">Approve</button>` : ''}
            ${item.needs_financial_support ? `<button class="btn-outline btn-xs btn-danger" onclick="denyProject('${item.id}')">Deny</button>` : ''}
            <button class="btn-outline btn-xs" onclick="markReviewed('${item.id}')">Review</button>
            ${item.status === 'cancelled'
              ? `<button class="btn-outline btn-xs" onclick="reactivateProject('${item.id}')">Reactivate</button>`
              : `<button class="btn-outline btn-xs btn-warn" onclick="cancelProject('${item.id}')">Cancel</button>`}
          </div>
        </div>
      </td>
    </tr>
  `).join('');
}

function getAdminReasonValue(id) {
  return $(`#adminReason-${CSS.escape(id)}`)?.value?.trim() || '';
}

async function loadAdmin() {
  const table = $('#adminProjectsTable');
  if (!table) return;

  try {
    const { items } = await api('/admin/projects');
    adminProjectsCache = Array.isArray(items) ? items : [];
    renderAdminProjects(adminProjectsCache);

    const donations = await api('/admin/donations');
    adminDonationsCache = Array.isArray(donations.items) ? donations.items : [];
    $('#adminDonationTable').innerHTML = adminDonationsCache.length
      ? adminDonationsCache.map(item => `
          <tr>
            <td>${item.id}</td>
            <td>${safeHtml(item.donation_type)}</td>
            <td>${safeHtml(item.donor_name || 'Anonymous')}</td>
            <td>${formatMoney((item.amount_project || 0) + (item.amount_platform || 0))}</td>
            <td>${safeHtml(item.payment_status)}</td>
            <td>${new Date(item.created_at).toLocaleString()}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="6">No donations found.</td></tr>';
  } catch (error) {
    table.innerHTML = `<tr><td colspan="8">${safeHtml(error.message)}. Login as admin first.</td></tr>`;
  }
}

async function updateAdminProject(id, payload, successMessage) {
  try {
    await api(`/admin/projects/${id}/review`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    alert(successMessage || 'Project updated.');
    await loadAdmin();
  } catch (error) {
    alert(error.message);
  }
}

async function approveProject(id) {
  await updateAdminProject(id, {
    funding_approved: true,
    financial_denied: false,
    denied_reason: '',
    admin_reviewed: true
  }, 'Financial support approved.');
}

async function denyProject(id) {
  await updateAdminProject(id, {
    funding_approved: false,
    financial_denied: true,
    denied_reason: getAdminReasonValue(id),
    admin_reviewed: true
  }, 'Financial support denied.');
}

async function cancelProject(id) {
  await updateAdminProject(id, {
    status: 'cancelled',
    cancellation_reason: getAdminReasonValue(id),
    admin_reviewed: true
  }, 'Project cancelled.');
}

async function reactivateProject(id) {
  await updateAdminProject(id, {
    status: 'active',
    cancellation_reason: '',
    admin_reviewed: true
  }, 'Project reactivated.');
}

async function markReviewed(id) {
  try {
    await api(`/admin/projects/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ admin_reviewed: true })
    });
    alert('Project marked as reviewed.');
    await loadAdmin();
  } catch (error) {
    alert(error.message);
  }
}

function initAdminFilters() {
  const table = $('#adminProjectsTable');
  if (!table) return;

  $('#adminApplyFiltersBtn')?.addEventListener('click', () => renderAdminProjects(adminProjectsCache));
  $('#adminClearFiltersBtn')?.addEventListener('click', () => {
    ['adminFilterTitle', 'adminFilterRequester', 'adminFilterStatus', 'adminFilterFinancial', 'adminFilterFundingStatus', 'adminFilterReviewed']
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    renderAdminProjects(adminProjectsCache);
  });

  ['adminFilterTitle', 'adminFilterRequester'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => renderAdminProjects(adminProjectsCache));
  });

  ['adminFilterStatus', 'adminFilterFinancial', 'adminFilterFundingStatus', 'adminFilterReviewed'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => renderAdminProjects(adminProjectsCache));
  });
}

function initButtons() {
  document.querySelectorAll('[data-logout]').forEach(el => el.addEventListener('click', logout));
  document.querySelectorAll('[data-load-projects]').forEach(el => el.addEventListener('click', loadProjects));
}

document.addEventListener('DOMContentLoaded', async () => {
  normalizeBrowserPath();
  setAuthUi();
  initButtons();
  handleAuthForms();
  handleSubmitProject();
  handlePlatformDonation();
  await refreshCurrentUser();
  loadProjects();
  loadProjectDetails();
  handleProfilePage();
  initAdminFilters();
  loadAdmin();
});

window.approveProject = approveProject;
window.denyProject = denyProject;
window.cancelProject = cancelProject;
window.reactivateProject = reactivateProject;
window.markReviewed = markReviewed;
