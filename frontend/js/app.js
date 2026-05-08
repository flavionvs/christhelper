const DEFAULT_API_BASE = 'https://api.christhelper.com';
const GA_MEASUREMENT_ID = 'G-VEBD7Q9H0S';
const GOOGLE_TAG_ID = '';
const GA_ALLOWED_EVENTS = new Set([
  'page_view',
  'sign_up',
  'login',
  'project_list_view',
  'project_view',
  'project_created',
  'project_response_submitted',
  'prayer_submitted',
  'reply_submitted',
  'project_report_submitted',
  'payment_started',
  'payment_completed',
  'platform_support_started',
  'platform_support_completed',
  'profile_view',
  'admin_view',
  'stripe_onboarding_started',
  'stripe_dashboard_opened',
  'project_card_clicked',
  'hero_verse_changed',
  'mobile_menu_toggled'
]);
const trackedOnceKeys = new Set();
let gaReady = false;

function loadGoogleAnalytics() {
  if (!GA_MEASUREMENT_ID) return;
  if (window.__christhelperGaInit) return;
  window.__christhelperGaInit = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: true,
    anonymize_ip: true
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GOOGLE_TAG_ID || GA_MEASUREMENT_ID)}`;
  script.onload = () => { gaReady = true; };
  document.head.appendChild(script);
}

function trackEvent(name, params = {}) {
  if (!GA_MEASUREMENT_ID || !GA_ALLOWED_EVENTS.has(name)) return;
  if (typeof window.gtag !== 'function') return;

  const cleanParams = {};
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      cleanParams[key] = value.join(',');
      return;
    }
    if (typeof value === 'object') return;
    cleanParams[key] = value;
  });

  window.gtag('event', name, cleanParams);
}

function trackOnce(key, name, params = {}) {
  if (trackedOnceKeys.has(key)) return;
  trackedOnceKeys.add(key);
  trackEvent(name, params);
}

function trackPageContext() {
  const pageName = document.body?.dataset?.page || document.title || window.location.pathname;
  trackOnce(`page:${window.location.pathname}${window.location.search}`, 'page_view', {
    page_title: document.title,
    page_path: window.location.pathname,
    page_location: window.location.href,
    page_name: pageName
  });

  if (window.location.pathname.endsWith('/profile.html')) {
    trackOnce('profile_view', 'profile_view', { page_path: window.location.pathname });
  }

  if (window.location.pathname.endsWith('/admin.html')) {
    trackOnce('admin_view', 'admin_view', { page_path: window.location.pathname });
  }

  if (window.location.pathname.endsWith('/success.html')) {
    const params = new URLSearchParams(window.location.search);
    const flowType = params.get('type') || 'project';
    trackOnce(`payment_success:${flowType}`, flowType === 'platform' ? 'platform_support_completed' : 'payment_completed', {
      flow_type: flowType,
      page_path: window.location.pathname
    });
  }
}

loadGoogleAnalytics();
const SITE_ORIGIN = window.location.origin.replace(/\/+$/, '');

function getFixedApiBase() {
  const stored = String(localStorage.getItem('christhelper.api') || '').trim().replace(/\/+$/, '');

  if (stored === DEFAULT_API_BASE) return DEFAULT_API_BASE;

  // Ignore old or broken values saved from local/dev or same-origin fallbacks.
  if (!stored) return DEFAULT_API_BASE;
  if (stored.includes('localhost') || stored.includes('127.0.0.1')) return DEFAULT_API_BASE;
  if (stored === SITE_ORIGIN || stored === `${SITE_ORIGIN}/api`) return DEFAULT_API_BASE;
  if (stored.endsWith('.azurestaticapps.net') || stored.endsWith('.azurefd.net')) return DEFAULT_API_BASE;
  if (!/^https:\/\//i.test(stored)) return DEFAULT_API_BASE;

  return stored;
}

let API_BASE = getFixedApiBase();
localStorage.setItem('christhelper.api', API_BASE);
const API_CANDIDATES = [API_BASE];
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

  const reviewedIcon = (project.admin_reviewed || !project.needs_financial_support)
    ? '<span class="review-status-icon" title="Visible" aria-label="Visible">✓</span>'
    : '';

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
      <div class="project-title-row">
        <h3>${safeHtml(project.title)}</h3>
        ${reviewedIcon}
      </div>
      <p class="project-summary">${safeHtml(project.summary)}</p>
      <p><strong>Organization:</strong> ${safeHtml(project.is_anonymous ? 'Anonymous request' : (project.organization_name || 'Not specified'))}</p>
      ${project.needs_financial_support && project.funding_approved ? `
        <div class="progress-wrap">
          <div style="display:flex;justify-content:space-between;gap:12px;">
            <strong>${formatMoney(project.amount_raised)}</strong>
            <span class="muted">Goal ${goalText}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      ` : '<div class="notice">View details to see full support options and request status.</div>'}
      <div class="project-actions">
        <a class="btn" href="project.html?id=${project.id}">View details</a>
        <a class="btn-outline" href="project.html?id=${project.id}#respond">Respond</a>
        <div class="project-action-stats">
          <span class="badge">💬 ${getReplyCount(project)} replies</span>
          <span class="badge">🙏 ${getPrayerCount(project)} prayers</span>
        </div>
      </div>
    </article>
  `;
}

async function loadProjects() {
  const grid = $('#projectsGrid');
  if (!grid) return;

  const params = new URLSearchParams();
  const fields = ['q', 'country', 'continent', 'category', 'helpType'];

  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el?.value) params.set(id, el.value);
  });

  if ($('#financialOnly')?.checked) params.set('financialOnly', '1');
  if ($('#reviewedOnly')?.checked) params.set('reviewedOnly', '1');
  if ($('#verifiedOnly')?.checked) params.set('verifiedOnly', '1');

  grid.innerHTML = '<p>Loading requests...</p>';

  try {
    const { items } = await api(`/projects?${params.toString()}`);
    if ($('#projectCount')) $('#projectCount').textContent = `${items.length} active requests`;
    grid.innerHTML = items.length
      ? items.map(projectCard).join('')
      : '<div class="card panel"><p>No requests found with these filters.</p></div>';

    trackOnce(`project_list_view:${window.location.pathname}:${params.toString()}`, 'project_list_view', {
      page_path: window.location.pathname,
      request_count: items.length,
      filter_count: Array.from(params.keys()).length
    });

    grid.querySelectorAll('a[href*="project.html?id="]').forEach((link) => {
      link.addEventListener('click', () => {
        const href = link.getAttribute('href') || '';
        const projectId = href.split('id=')[1]?.split('#')[0] || '';
        trackEvent('project_card_clicked', {
          project_id: projectId,
          action: href.includes('#respond') ? 'respond' : 'view',
          page_path: window.location.pathname
        });
      });
    });
  } catch (error) {
    const candidates = API_CANDIDATES.map(safeHtml).join('<br>');
    grid.innerHTML = `<div class="card panel"><p>${safeHtml(error.message)}</p><p class="muted" style="margin-top:10px;">API candidates tried:</p><div class="muted">${candidates}</div></div>`;
  }
}

async function loadAllProjectsForSubmitPage() {
  const wrap = $('#allProjectsList');
  if (!wrap) return;

  wrap.innerHTML = '<p class="muted">Loading requests...</p>';

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
              <a class="btn-outline" href="project.html?id=${project.id}">Open</a>
            </div>
          </div>
        `).join('')
      : '<p class="muted">No requests found yet.</p>';
  } catch (error) {
    wrap.innerHTML = `<p>${safeHtml(error.message)}</p>`;
  }
}

function buildCombinedResponses(prayers = [], replies = []) {
  const prayerItems = prayers.map(item => ({
    kind: 'Prayer',
    name: item.name || 'Anonymous',
    message: item.message || '',
    typeLabel: 'Prayer',
    createdAt: item.created_at || item.createdAt || ''
  }));

  const replyItems = replies.map(item => ({
    kind: 'Reply',
    name: item.name || 'Anonymous',
    message: item.message || '',
    typeLabel: item.type || 'Reply',
    createdAt: item.created_at || item.createdAt || ''
  }));

  return [...prayerItems, ...replyItems].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

async function loadProjectDetails() {
  const root = $('#projectDetails');
  if (!root) return;

  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    root.innerHTML = '<div class="card panel"><p>Missing request id.</p></div>';
    return;
  }

  try {
    const data = await api(`/projects/${id}`);
    const { project, prayers, replies, updates, stats, response_visibility } = data;

    trackOnce(`project_view:${id}`, 'project_view', {
      project_id: id,
      category: project.category || '',
      country: project.country || '',
      help_types: Array.isArray(project.help_types) ? project.help_types.join(',') : '',
      needs_financial_support: Boolean(project.needs_financial_support)
    });
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
            <div class="project-title-row" style="margin-top:12px;">
              <h1 style="font-size:2.3rem;margin:0;">${safeHtml(project.title)}</h1>
              ${(project.admin_reviewed || !project.needs_financial_support) ? '<span class="review-status-icon review-status-icon-lg" title="Visible" aria-label="Visible">✓</span>' : ''}
            </div>
            <p>${safeHtml(project.summary)}</p>
            <div class="badge-row">
              ${(project.help_types || []).map(h => `<span class="badge">${safeHtml(h)}</span>`).join('')}
              ${project.verified_ministry ? '<span class="badge good">Verified church/ministry</span>' : ''}
              ${project.needs_financial_support ? '<span class="badge">Financial support requested</span>' : ''}
              ${project.is_anonymous ? '<span class="badge">Anonymous request</span>' : ''}
              ${project.needs_financial_support && !project.owner_can_receive_payments ? '<span class="badge warn">Stripe setup pending</span>' : ''}
            </div>
            <div class="stats-row">
              <div class="stat"><strong>${stats.prayer_count}</strong><span class="muted">Prayer supporters</span></div>
              <div class="stat"><strong>${stats.reply_count}</strong><span class="muted">Replies and offers</span></div>
            </div>
          </section>

          <section class="card panel">
            <h2>Request information</h2>
            <p>${safeHtml(project.description)}</p>
            <div class="list">
              <div class="item"><strong>Organization</strong>${safeHtml(project.is_anonymous ? 'Anonymous request' : (project.organization_name || 'Not specified'))}</div>
              <div class="item"><strong>Why it matters</strong>${safeHtml(project.why_it_matters || 'Not specified')}</div>
              ${project.project_links && Array.isArray(project.project_links) && project.project_links.length ? `
                <div class="item">
                  <strong>Important links</strong>
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

          <section class="card panel" id="respond">
            <h2>Respond</h2>
            <p>Send one message and choose whether it is a prayer or a reply.</p>
            <form id="respondForm" class="simple-form">
              <select name="kind" id="responseKind" required>
                <option value="prayer">Prayer</option>
                <option value="reply">Reply</option>
              </select>
              <select name="type" id="responseSupportType" class="hide">
                <option value="">Select reply type</option>
                <option>Guidance</option>
                <option>Volunteer</option>
                <option>Mentorship</option>
                <option>Services</option>
                <option>Encouragement</option>
              </select>
              <input name="name" placeholder="Your name${token ? '' : ' (optional)'}">
              <input name="email" id="responseEmail" type="email" placeholder="Your email (optional)" class="hide">
              <textarea name="message" id="responseMessage" placeholder="Write your response" required></textarea>
              <button class="btn" type="submit">Send response</button>
            </form>
          </section>

          <section class="card panel">
            <h2>Community responses</h2>
            <div id="responseList" class="list" style="margin-top:16px;">
              ${response_visibility?.showing_responses === false
                ? `<div class="notice">Prayers and replies are private for this request. Only the request creator can view them.</div>`
                : (buildCombinedResponses(prayers, replies).length
                    ? buildCombinedResponses(prayers, replies).map(item => `
                        <div class="item response-item">
                          <div class="response-item-head">
                            <strong>${safeHtml(item.name)}</strong>
                            <span class="badge ${item.kind === 'Prayer' ? 'good' : ''}">${safeHtml(item.typeLabel)}</span>
                          </div>
                          <div>${safeHtml(item.message || '')}</div>
                        </div>
                      `).join('')
                    : '<p class="muted">No responses yet.</p>')}
            </div>
          </section>

          <section class="card panel">
            <h2>Request updates</h2>
            <div class="list">
              ${updates.length
                ? updates.map(item => `<div class="item"><strong>${safeHtml(item.title)}</strong>${safeHtml(item.content)}<div class="muted" style="margin-top:8px;">${new Date(item.created_at).toLocaleString()}</div></div>`).join('')
                : '<p class="muted">No updates yet.</p>'}
            </div>
          </section>
        </div>

        <aside class="stack">
          <section class="card panel">
            <h2>Support this request</h2>
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
                <div class="notice" style="margin-top:16px;">Payments for financial support are processed in USD. Stripe transaction fees apply per payment, so the amount paid by the supporter and the net amount received by the request owner may be different.</div>
                <form id="projectDonationForm" class="simple-form" style="margin-top:16px;">
                  <input name="donor_name" placeholder="Your name">
                  <input name="donor_email" type="email" placeholder="Your email">
                  <textarea name="donor_message" placeholder="Optional message"></textarea>
                  <input name="amount_project" type="number" min="1" step="0.01" placeholder="Amount for this request (USD)" required>
                  <input name="amount_platform" type="number" min="0" step="0.01" placeholder="Optional support value (USD)">
                  <button class="btn" type="submit">Continue to secure payment</button>
                </form>
              ` : '<p class="muted" style="margin-top:14px;">This request is approved, but the owner still needs to finish Stripe onboarding before donations can be accepted.</p>'}
            ` : '<p class="muted">Financial support is not available yet for this request. You can still respond with prayer, guidance, volunteering, and encouragement.</p>'}
          </section>

          <section class="card panel">
            <h3>Report request</h3>
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
    const respondForm = $('#respondForm');
    const responseKind = $('#responseKind');
    const responseSupportType = $('#responseSupportType');
    const responseEmail = $('#responseEmail');
    const responseMessage = $('#responseMessage');

    function syncRespondForm() {
      const selected = responseKind?.value || 'prayer';
      const isReply = selected === 'reply';
      responseSupportType?.classList.toggle('hide', !isReply);
      responseEmail?.classList.toggle('hide', !isReply);
      if (responseSupportType) responseSupportType.required = isReply;
      if (responseEmail && !isReply) responseEmail.value = '';
      if (responseSupportType && !isReply) responseSupportType.value = '';
      if (responseMessage) {
        responseMessage.placeholder = isReply
          ? 'Write your reply, offer, guidance, or encouragement'
          : 'Write your prayer or encouragement';
      }
    }

    responseKind?.addEventListener('change', syncRespondForm);
    syncRespondForm();

    respondForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const kind = String(fd.get('kind') || 'prayer').toLowerCase();

      try {
        const result = await api(`/projects/${id}/respond`, {
          method: 'POST',
          body: JSON.stringify({
            kind,
            type: fd.get('type'),
            name: fd.get('name') || 'Anonymous',
            email: fd.get('email'),
            message: fd.get('message')
          })
        });

        trackEvent('project_response_submitted', {
          project_id: id,
          kind,
          reply_type: kind === 'reply' ? String(fd.get('type') || 'general') : '',
          page_path: window.location.pathname
        });
        trackEvent(kind === 'prayer' ? 'prayer_submitted' : 'reply_submitted', {
          project_id: id,
          reply_type: kind === 'reply' ? String(fd.get('type') || 'general') : '',
          page_path: window.location.pathname
        });
        alert(result?.message || 'Your response has been sent.');
        e.target.reset();
        if (responseKind) responseKind.value = 'prayer';
        syncRespondForm();
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
        trackEvent('project_report_submitted', { project_id: id, page_path: window.location.pathname });
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
        trackEvent('payment_started', {
          project_id: id,
          currency: 'USD',
          amount_project: Number(fd.amount_project || 0),
          amount_platform: Number(fd.amount_platform || 0),
          page_path: window.location.pathname
        });
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
      const formData = new FormData(registerForm);
      const payload = Object.fromEntries(formData);
      payload.terms_accepted = formData.get('terms_accepted') === 'on';
      try {
        const data = await api('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
        trackEvent('sign_up', { method: 'email', page_path: window.location.pathname });
        alert(data.message || 'Verification code sent.');
        window.location.href = appPath(`verify-email.html?email=${encodeURIComponent(data.email || payload.email || '')}`);
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
        trackEvent('login', { method: 'email', page_path: window.location.pathname });
        setStoredAuth(data.token, data.user);
        window.location.href = appPath('profile.html');
      } catch (error) {
        const requiresVerification = /verify your email/i.test(error.message || '');
        if (requiresVerification) {
          alert(error.message);
          window.location.href = appPath(`verify-email.html?email=${encodeURIComponent(payload.email || '')}`);
          return;
        }
        alert(error.message);
      }
    });
  }

  const verifyForm = $('#verifyEmailForm');
  if (verifyForm) {
    const emailField = verifyForm.querySelector('[name="email"]');
    const params = new URLSearchParams(window.location.search);
    if (emailField && !emailField.value) emailField.value = params.get('email') || '';

    verifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(verifyForm));
      try {
        const data = await api('/auth/verify-email', { method: 'POST', body: JSON.stringify(payload) });
        setStoredAuth(data.token, data.user);
        alert(data.message || 'Email verified successfully.');
        window.location.href = appPath('profile.html');
      } catch (error) {
        alert(error.message);
      }
    });

    $('#resendVerificationBtn')?.addEventListener('click', async () => {
      const email = emailField?.value?.trim();
      if (!email) {
        alert('Enter your email first.');
        return;
      }
      try {
        const data = await api('/auth/resend-verification', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
        alert(data.message || 'Verification code sent.');
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const forgotForm = $('#forgotPasswordForm');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(forgotForm));
      try {
        const data = await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify(payload) });
        alert(data.message || 'Reset code sent.');
        window.location.href = appPath(`reset-password.html?email=${encodeURIComponent(payload.email || '')}`);
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const resetForm = $('#resetPasswordForm');
  if (resetForm) {
    const emailField = resetForm.querySelector('[name="email"]');
    const params = new URLSearchParams(window.location.search);
    if (emailField && !emailField.value) emailField.value = params.get('email') || '';

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(resetForm));
      if (payload.password !== payload.confirm_password) {
        alert('Passwords do not match.');
        return;
      }
      try {
        const data = await api('/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ email: payload.email, code: payload.code, password: payload.password })
        });
        setStoredAuth(data.token, data.user);
        alert(data.message || 'Password updated successfully.');
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
  const goalWrap = $('#financialGoalWrap');
  const goalInput = $('#fundingGoal') || $('[name="funding_goal"]');
  const currencyInput = $('#fundingGoalCurrency') || $('[name="funding_goal_currency"]');
  const helpTypeInputs = Array.from(document.querySelectorAll('input[name="help_types"]'));
  const hasFinancialSupport = helpTypeInputs.some((input) => input.checked && String(input.value || '').toLowerCase() === 'financial support');

  if (goalWrap) goalWrap.classList.toggle('hide', !hasFinancialSupport);
  if (currencyInput) currencyInput.value = hasFinancialSupport ? 'USD' : '';

  if (goalInput) {
    goalInput.required = hasFinancialSupport;
    if (!hasFinancialSupport) goalInput.value = '';
  }

  syncAnonymousOption(hasFinancialSupport);
}

function syncAnonymousOption(hasFinancialSupportParam = null) {
  const anonymousInput = $('#submitAnonymousOption') || $('[name="is_anonymous"]');
  const anonymousInfo = $('#submitAnonymousInfo');
  if (!anonymousInput) return;

  const hasFinancialSupport = hasFinancialSupportParam !== null
    ? Boolean(hasFinancialSupportParam)
    : Array.from(document.querySelectorAll('input[name="help_types"]')).some((input) => input.checked && String(input.value || '').toLowerCase() === 'financial support');

  anonymousInput.disabled = hasFinancialSupport;
  if (hasFinancialSupport) anonymousInput.checked = false;

  if (anonymousInfo) {
    const infoText = hasFinancialSupport
      ? 'Anonymous is not available when Financial support is selected. Public requester identity is required for financial requests.'
      : 'Available only for non-financial requests. When enabled, your identity will not be shown publicly.';
    anonymousInfo.title = infoText;
    anonymousInfo.setAttribute('aria-label', infoText);
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

  Array.from(document.querySelectorAll('input[name="help_types"]')).forEach((el) => {
    el.addEventListener('change', toggleFinancialFields);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd);

    payload.is_online = fd.get('is_online') === 'on';
    payload.is_anonymous = fd.get('is_anonymous') === 'on';
    payload.responses_public = fd.get('responses_public') !== null;
    payload.help_types = fd.getAll('help_types');
    payload.needs_financial_support = payload.help_types.includes('Financial support');
    payload.project_links = parseProjectLinks(payload.project_links);
    payload.continent = payload.continent || detectContinentFromCountry(payload.country);

    if (payload.needs_financial_support) {
      payload.funding_goal_currency = 'USD';

      if (!currentUser?.stripe_account_id) {
        alert('Please connect Stripe in your profile before submitting a request that needs financial support.');
        window.location.href = appPath('profile.html');
        return;
      }

      if (!currentUser?.stripe_charges_enabled) {
        alert('Your Stripe account is connected, but setup is not finished yet. Please finish Stripe onboarding in your profile before submitting a financial request.');
        window.location.href = appPath('profile.html');
        return;
      }

      if (!payload.funding_goal || Number(payload.funding_goal) <= 0) {
        alert('Please enter a funding goal in USD.');
        return;
      }

    } else {
      payload.funding_goal = payload.funding_goal || 0;
      payload.funding_goal_currency = '';
    }

    if (payload.needs_financial_support) {
      payload.is_anonymous = false;
    }

    if (!payload.campaign_expiry_date) {
      alert('Please set a campaign expiry date.');
      return;
    }

    try {
      await api('/projects', { method: 'POST', body: JSON.stringify(payload) });
      trackEvent('project_created', {
        category: payload.category || '',
        country: payload.country || '',
        is_online: Boolean(payload.is_online),
        needs_financial_support: Boolean(payload.needs_financial_support),
        help_types: Array.isArray(payload.help_types) ? payload.help_types.join(',') : '',
        page_path: window.location.pathname
      });
      alert(payload.needs_financial_support
        ? 'Request submitted successfully. Because Stripe is ready, your financial request can move to admin review.'
        : 'Request submitted successfully.');
      form.reset();
      buildCountryDropdown();
      fillContinentFromCountry();
      toggleFinancialFields();
      window.location.href = appPath('profile.html');
    } catch (error) {
      alert(error.message.includes('Missing token') ? 'Please login first to submit a request.' : error.message);
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
      trackEvent('platform_support_started', {
        currency: 'USD',
        amount_platform: Number(payload.amount_platform || payload.amount || 0),
        page_path: window.location.pathname
      });
      trackEvent('payment_started', {
        flow_type: 'platform',
        currency: 'USD',
        amount_platform: Number(payload.amount_platform || payload.amount || 0),
        page_path: window.location.pathname
      });
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
        Stripe Express access uses a secure login link. Use the dashboard button whenever you want to open Stripe.
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
              <th>Request amount</th>
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
              <span class="badge">${project.needs_financial_support ? (project.admin_reviewed ? 'Reviewed' : 'Pending review') : 'Live'}</span>
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
    : '<p class="muted">No requests in this section.</p>';
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
                ${mergedUser?.role === 'admin' ? '<a class="btn-outline" href="/admin.html">Open admin page</a>' : ''}
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
                For financial requests, the flow is: create request → admin approves financial support → your Stripe account is ready → donations open.
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
              <h2>My requests</h2>
              <p class="muted">Requests you submitted on ChristHelper.</p>

              <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 16px;">
                <button class="btn-outline" type="button" data-project-filter="all">All</button>
                <button class="btn-outline" type="button" data-project-filter="active">Active</button>
                <button class="btn-outline" type="button" data-project-filter="draft">Drafts</button>
                <button class="btn-outline" type="button" data-project-filter="archived">Archived</button>
                <button class="btn-outline" type="button" data-project-filter="excluded">Excluded</button>
              </div>

              <div id="profileProjectsList" class="list"></div>

              <div style="margin-top:16px;">
                <a class="btn" href="/submit.html">Submit new request</a>
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
        trackEvent('stripe_onboarding_started', { page_path: window.location.pathname });
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
let adminUsersCache = [];

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
  if (!project?.needs_financial_support) return '<span class="badge good">Not required</span>';
  return project?.admin_reviewed
    ? '<span class="badge good">Reviewed</span>'
    : '<span class="badge warn">Pending</span>';
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
  if (requester && !(`${String(project.requester_name || '')} ${String(project.organization_name || '')}`.toLowerCase()).includes(requester)) return false;
  if (status && String(project.status || 'active') !== status) return false;
  if (financial === 'yes' && !project.needs_financial_support) return false;
  if (financial === 'no' && project.needs_financial_support) return false;

  const normalizedFundingStatus = getAdminFundingStatus(project).toLowerCase().replace(/\s+/g, '_');
  if (fundingStatus && normalizedFundingStatus !== fundingStatus) return false;

  if (reviewed === 'yes' && !(project.needs_financial_support ? project.admin_reviewed : true)) return false;
  if (reviewed === 'no' && (project.needs_financial_support ? project.admin_reviewed : true)) return false;

  return true;
}

function renderAdminProjects(items) {
  const table = $('#adminProjectsTable');
  if (!table) return;

  const filtered = (items || []).filter(matchesAdminFilters);
  const countEl = $('#adminProjectsCount');
  if (countEl) countEl.textContent = `${filtered.length} request${filtered.length === 1 ? '' : 's'}`;

  if (!filtered.length) {
    table.innerHTML = '<tr><td colspan="8">No requests found with these filters.</td></tr>';
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
      <td>${safeHtml(item.organization_name || '-')}</td>
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
    alert(successMessage || 'Request updated.');
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
  }, 'Request cancelled.');
}

async function reactivateProject(id) {
  await updateAdminProject(id, {
    status: 'active',
    cancellation_reason: '',
    admin_reviewed: true
  }, 'Request reactivated.');
}

async function markReviewed(id) {
  try {
    await api(`/admin/projects/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ admin_reviewed: true })
    });
    alert('Request marked as reviewed.');
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


function matchesAdminUserFilters(user) {
  const search = ($('#adminUserSearch')?.value || '').trim().toLowerCase();
  const role = $('#adminUserRoleFilter')?.value || '';
  const status = $('#adminUserStatusFilter')?.value || '';

  if (search) {
    const haystack = [
      user.name,
      user.email,
      user.country,
      user.organization_name,
      user.role,
      user.id
    ].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(search)) return false;
  }

  if (role && String(user.role || '') !== role) return false;
  if (status === 'active' && user.is_active === false) return false;
  if (status === 'inactive' && user.is_active !== false) return false;

  return true;
}

function getAdminUserRoleBadge(user) {
  return String(user?.role || '') === 'admin'
    ? '<span class="badge good">Admin</span>'
    : '<span class="badge">Supporter</span>';
}

function getAdminUserStatusBadge(user) {
  return user?.is_active === false
    ? '<span class="badge warn">Inactive</span>'
    : '<span class="badge good">Active</span>';
}

function renderAdminUsers(items) {
  const table = $('#adminUsersTable');
  if (!table) return;

  const filtered = (items || []).filter(matchesAdminUserFilters);
  const countEl = $('#adminUsersCount');
  if (countEl) countEl.textContent = `${filtered.length} user${filtered.length === 1 ? '' : 's'}`;

  if (!filtered.length) {
    table.innerHTML = '<tr><td colspan="8">No users found with these filters.</td></tr>';
    return;
  }

  table.innerHTML = filtered.map((user) => {
    const isSelf = currentUser?.id && user.id === currentUser.id;
    const inactive = user.is_active === false;
    return `
      <tr>
        <td>
          <div class="admin-user-cell">
            <strong>${safeHtml(user.name || 'Unnamed user')}</strong>
            <span class="admin-user-meta">${safeHtml(user.email || '—')}</span>
            <span class="admin-user-meta">ID: ${safeHtml(user.id)}</span>
          </div>
        </td>
        <td>${getAdminUserRoleBadge(user)}</td>
        <td>${getAdminUserStatusBadge(user)}</td>
        <td>${safeHtml(user.country || '—')}</td>
        <td>${safeHtml(user.organization_name || '—')}</td>
        <td>${Number(user.request_count || 0)}</td>
        <td>${formatIsoDateTime(user.created_at)}</td>
        <td>
          <div class="admin-actions">
            <div class="admin-user-meta" style="margin-bottom:8px;">
              ${user.last_login_at ? `Last login: ${safeHtml(formatIsoDateTime(user.last_login_at))}` : 'Last login: —'}
              ${isSelf ? '<br>Your account' : ''}
            </div>
            <div class="admin-actions-row wrap">
              <button class="btn-outline btn-xs ${inactive ? '' : 'btn-warn'}" onclick="toggleUserActive('${safeHtml(user.id)}', ${inactive ? 'true' : 'false'})" ${isSelf ? 'disabled' : ''}>
                ${inactive ? 'Activate' : 'Inactivate'}
              </button>
              <button class="btn-outline btn-xs" onclick="promoteUserToAdmin('${safeHtml(user.id)}')" ${String(user.role) === 'admin' ? 'disabled' : ''}>
                Promote to Admin
              </button>
              <button class="btn-outline btn-xs btn-danger" onclick="deleteUserAccount('${safeHtml(user.id)}')" ${isSelf ? 'disabled' : ''}>
                Exclude
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadAdminUsers() {
  const table = $('#adminUsersTable');
  if (!table) return;

  try {
    const { items } = await api('/admin/users');
    adminUsersCache = Array.isArray(items) ? items : [];
    renderAdminUsers(adminUsersCache);
  } catch (error) {
    table.innerHTML = `<tr><td colspan="8">${safeHtml(error.message)}. Login as admin first.</td></tr>`;
  }
}

async function toggleUserActive(id, currentlyInactive) {
  const action = currentlyInactive ? 'activate' : 'inactivate';
  const ok = window.confirm(`Are you sure you want to ${action} this user?`);
  if (!ok) return;

  try {
    await api(`/admin/users/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
    alert(`User ${action}d successfully.`);
    await loadAdminUsers();
  } catch (error) {
    alert(error.message);
  }
}

async function promoteUserToAdmin(id) {
  const ok = window.confirm('Are you sure you want to promote this user to admin?');
  if (!ok) return;

  try {
    await api(`/admin/users/${id}/promote`, { method: 'POST', body: JSON.stringify({}) });
    alert('User promoted to admin.');
    await loadAdminUsers();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteUserAccount(id) {
  const ok = window.confirm('Are you sure you want to exclude this user? This permanently removes the account when allowed.');
  if (!ok) return;

  try {
    await api(`/admin/users/${id}`, { method: 'DELETE' });
    alert('User removed successfully.');
    await loadAdminUsers();
  } catch (error) {
    alert(error.message);
  }
}

function initAdminUserFilters() {
  const table = $('#adminUsersTable');
  if (!table) return;

  $('#adminApplyUserFiltersBtn')?.addEventListener('click', () => renderAdminUsers(adminUsersCache));
  $('#adminClearUserFiltersBtn')?.addEventListener('click', () => {
    ['adminUserSearch', 'adminUserRoleFilter', 'adminUserStatusFilter'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    renderAdminUsers(adminUsersCache);
  });

  document.getElementById('adminUserSearch')?.addEventListener('input', () => renderAdminUsers(adminUsersCache));
  ['adminUserRoleFilter', 'adminUserStatusFilter'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => renderAdminUsers(adminUsersCache));
  });
}

function initFilterPanels() {
  const mobileFilterQuery = window.matchMedia('(max-width: 900px)');

  document.querySelectorAll('.filter-panel').forEach((panel) => {
    const toggle = panel.querySelector('[data-filter-toggle]');
    const content = panel.querySelector('[data-filter-content]');
    if (!toggle || !content) return;

    const syncFilterState = () => {
      const isMobile = mobileFilterQuery.matches;
      const isOpen = panel.classList.contains('is-open');

      if (isMobile) {
        content.hidden = !isOpen;
        toggle.setAttribute('aria-expanded', String(isOpen));
      } else {
        content.hidden = false;
        panel.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'true');
      }
    };

    panel.classList.remove('is-open');
    syncFilterState();

    toggle.addEventListener('click', () => {
      if (!mobileFilterQuery.matches) return;

      const isOpen = panel.classList.toggle('is-open');
      content.hidden = !isOpen;
      toggle.setAttribute('aria-expanded', String(isOpen));
      trackEvent('request_filters_toggled', { is_open: isOpen, page_path: window.location.pathname });
    });

    panel.querySelectorAll('[data-load-projects]').forEach((button) => {
      button.addEventListener('click', () => {
        if (mobileFilterQuery.matches) {
          panel.classList.remove('is-open');
          content.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    });

    if (typeof mobileFilterQuery.addEventListener === 'function') {
      mobileFilterQuery.addEventListener('change', syncFilterState);
    } else if (typeof mobileFilterQuery.addListener === 'function') {
      mobileFilterQuery.addListener(syncFilterState);
    }
  });
}

function initButtons() {
  document.querySelectorAll('[data-logout]').forEach(el => el.addEventListener('click', logout));
  document.querySelectorAll('[data-load-projects]').forEach(el => el.addEventListener('click', loadProjects));
}

document.addEventListener('DOMContentLoaded', async () => {
  normalizeBrowserPath();
  trackPageContext();
  setAuthUi();
  initButtons();
  initMobileMenu();
  initFilterPanels();
  initHeroVerseCarousel();
  handleAuthForms();
  handleSubmitProject();
  handlePlatformDonation();
  await refreshCurrentUser();
  loadProjects();
  loadProjectDetails();
  handleProfilePage();
  initAdminFilters();
  initAdminUserFilters();
  loadAdmin();
  loadAdminUsers();
});

window.approveProject = approveProject;
window.denyProject = denyProject;
window.cancelProject = cancelProject;
window.reactivateProject = reactivateProject;
window.markReviewed = markReviewed;
window.toggleUserActive = toggleUserActive;
window.promoteUserToAdmin = promoteUserToAdmin;
window.deleteUserAccount = deleteUserAccount;




// ===== HERO VERSE CAROUSEL =====
function initHeroVerseCarousel() {
  const carousel = document.querySelector('[data-verse-carousel]');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('[data-verse-slide]'));
  const dots = Array.from(carousel.querySelectorAll('[data-verse-dot]'));
  const prev = carousel.querySelector('[data-verse-prev]');
  const next = carousel.querySelector('[data-verse-next]');
  if (!slides.length) return;

  let currentIndex = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));
  if (currentIndex < 0) currentIndex = 0;
  let autoplay = null;
  let touchStartX = 0;
  let touchDeltaX = 0;

  function render(index) {
    currentIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle('is-active', i === currentIndex));
    dots.forEach((dot, i) => {
      const isActive = i === currentIndex;
      dot.classList.toggle('is-active', isActive);
      dot.setAttribute('aria-current', isActive ? 'true' : 'false');
    });

    trackEvent('hero_verse_changed', {
      slide_index: currentIndex + 1,
      page_path: window.location.pathname
    });
  }

  function stopAutoplay() {
    if (autoplay) {
      window.clearInterval(autoplay);
      autoplay = null;
    }
  }

  function startAutoplay() {
    stopAutoplay();
    autoplay = window.setInterval(() => render(currentIndex + 1), 4500);
  }

  prev?.addEventListener('click', () => {
    render(currentIndex - 1);
    startAutoplay();
  });

  next?.addEventListener('click', () => {
    render(currentIndex + 1);
    startAutoplay();
  });

  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
      render(index);
      startAutoplay();
    });
  });

  carousel.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0]?.clientX || 0;
    touchDeltaX = 0;
  }, { passive: true });

  carousel.addEventListener('touchmove', (event) => {
    const currentX = event.changedTouches[0]?.clientX || 0;
    touchDeltaX = currentX - touchStartX;
  }, { passive: true });

  carousel.addEventListener('touchend', () => {
    if (Math.abs(touchDeltaX) > 35) {
      render(currentIndex + (touchDeltaX < 0 ? 1 : -1));
      startAutoplay();
    }
  }, { passive: true });

  carousel.addEventListener('mouseenter', stopAutoplay);
  carousel.addEventListener('mouseleave', startAutoplay);

  render(currentIndex);
  startAutoplay();
}


// ===== MOBILE MENU =====
function initMobileMenu() {
  const toggles = document.querySelectorAll('#navToggle');
  const menus = document.querySelectorAll('#navMenu');
  if (!toggles.length || !menus.length) return;

  toggles.forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      const nav = toggle.parentElement.querySelector('#navMenu');
      if (!nav) return;
      const isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      trackEvent('mobile_menu_toggled', { is_open: isOpen, page_path: window.location.pathname });
    });
  });

  menus.forEach(function (nav) {
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('is-open');
        const toggle = nav.parentElement.querySelector('#navToggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
    });
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 720) {
      menus.forEach(function (nav) { nav.classList.remove('is-open'); });
      toggles.forEach(function (toggle) { toggle.setAttribute('aria-expanded', 'false'); });
    }
  });
}
