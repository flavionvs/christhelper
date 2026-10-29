const FINANCIAL_SUPPORT_ENABLED = false;
const FINANCIAL_SUPPORT_NOTICE = "Financial support is not managed through the platform. You may include financial needs in the description, but any financial assistance must be arranged outside the platform.";
const isFinancialType = value => /financial|fundraising|donation/i.test(String(value || ''));

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
  'feedback_submitted',
  'volunteer_application_submitted',
  'payment_started',
  'payment_completed',
  'platform_support_started',
  'platform_support_completed',
  'profile_view',
  'admin_view',
  'stripe_onboarding_started',
  'stripe_dashboard_opened',
  'project_card_clicked',
  'project_shared',
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
  if (!value) return '-';
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


function getResponseCount(project) {
  return getReplyCount(project) + getPrayerCount(project);
}

function responseCountBadge(project) {
  return `<span class="badge">${formatResponseCountLabel(getResponseCount(project))}</span>`;
}

function getProjectShareUrl(projectId) {
  const id = encodeURIComponent(String(projectId || '').trim());
  return new URL(`/project.html?id=${id}`, window.location.origin).href;
}

function getShareIcon() {
  return `
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 1 0 15 5c0 .24.04.47.09.7L8.04 9.81A3 3 0 1 0 8.04 14.2l7.12 4.18c-.05.2-.08.41-.08.62a2.92 2.92 0 1 0 2.92-2.92Z" fill="currentColor"/>
    </svg>
  `;
}

function shareButton(project, extraClass = '') {
  const id = project?.id || '';
  const title = project?.title || 'ChristHelper request';
  return `
    <button
      type="button"
      class="share-project-btn ${extraClass}"
      data-project-id="${safeHtml(id)}"
      data-project-title="${safeHtml(title)}"
      data-project-url="${safeHtml(getProjectShareUrl(id))}"
      aria-label="Share this request"
      title="Share this request"
    >
      ${getShareIcon()}
      <span class="share-project-label">Share</span>
    </button>
  `;
}

async function copyTextFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function showShareFeedback(button, message) {
  const label = button?.querySelector('.share-project-label');
  if (!label) {
    window.alert(message);
    return;
  }
  const original = label.textContent;
  label.textContent = message;
  button.classList.add('is-copied');
  window.setTimeout(() => {
    label.textContent = original || 'Share';
    button.classList.remove('is-copied');
  }, 1800);
}

async function handleProjectShare(button) {
  const url = button.dataset.projectUrl || getProjectShareUrl(button.dataset.projectId);
  const title = button.dataset.projectTitle || 'ChristHelper request';
  const text = `Please see this ChristHelper request: ${title}`;

  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      showShareFeedback(button, 'Shared');
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      showShareFeedback(button, 'Copied');
    } else {
      await copyTextFallback(url);
      showShareFeedback(button, 'Copied');
    }

    trackEvent('project_shared', {
      project_id: button.dataset.projectId || '',
      page_path: window.location.pathname
    });
  } catch (error) {
    if (error?.name === 'AbortError') return;
    try {
      await copyTextFallback(url);
      showShareFeedback(button, 'Copied');
    } catch (_) {
      window.prompt('Copy this request link:', url);
    }
  }
}

function initProjectShareButtons() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.share-project-btn');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    handleProjectShare(button);
  });
}

function getProjectDescriptionText(project) {
  return project?.description || project?.summary || '';
}

function projectReadMoreLink(project) {
  return `<a class="project-read-more" href="project.html?id=${project.id}" hidden>Read More</a>`;
}

/* ===== Prayer helpers (shared by request cards and the Request Details page) ===== */
const PRAYED_REQUESTS_KEY = 'christhelper.prayedRequests';

function getPrayIcon() {
  return '<span class="pray-icon" aria-hidden="true">🙏</span>';
}

// Browser-side memory of prayers, scoped to the logged-in account so two people
// sharing a browser never see each other's "prayed" state. Anonymous visitors
// keep the original device-only key.
function getPrayedRequestsStorageKey() {
  return currentUser?.id ? `${PRAYED_REQUESTS_KEY}.user.${currentUser.id}` : PRAYED_REQUESTS_KEY;
}

function getPrayedRequestIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(getPrayedRequestsStorageKey()) || '[]');
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch (_) {
    return [];
  }
}

// serverHasPrayed comes from the API (project.has_prayed / viewer.has_prayed).
// When logged in, the server is the source of truth, so the state follows the
// account across devices (pray on mobile -> shows as prayed on desktop).
function hasPrayedForRequest(projectId, serverHasPrayed) {
  if (serverHasPrayed === true) return true;
  if (currentUser && typeof serverHasPrayed === 'boolean') return serverHasPrayed;
  return getPrayedRequestIds().includes(String(projectId));
}

function rememberPrayedRequest(projectId) {
  try {
    const ids = getPrayedRequestIds().filter(id => id !== String(projectId));
    ids.push(String(projectId));
    localStorage.setItem(getPrayedRequestsStorageKey(), JSON.stringify(ids.slice(-500)));
  } catch (_) {
    /* storage unavailable: the prayer is still recorded on the server */
  }
}

function getDefaultResponderName() {
  return currentUser?.name ? String(currentUser.name) : '';
}

async function submitPrayer(projectId, { name = '', message = '', anonymous = false } = {}) {
  const trimmedMessage = String(message || '').trim();
  const result = await api(`/projects/${projectId}/respond`, {
    method: 'POST',
    body: JSON.stringify({
      kind: 'prayer',
      name: anonymous ? 'Anonymous' : (String(name || '').trim() || 'Anonymous'),
      is_anonymous: Boolean(anonymous),
      message: trimmedMessage
    })
  });

  rememberPrayedRequest(projectId);
  trackEvent('project_response_submitted', {
    project_id: projectId,
    kind: 'prayer',
    reply_type: '',
    with_message: Boolean(trimmedMessage),
    page_path: window.location.pathname
  });
  trackEvent('prayer_submitted', {
    project_id: projectId,
    reply_type: '',
    with_message: Boolean(trimmedMessage),
    page_path: window.location.pathname
  });

  return result;
}

function formatResponseCountLabel(count) {
  return `🙏 ${count} ${count === 1 ? 'prayer/reply' : 'prayers/replies'}`;
}

function projectCardPrayForm(project) {
  const id = safeHtml(project.id);
  return `
    <div class="project-card-pray" data-card-pray-panel hidden>
      <form class="pray-form" data-card-pray-form data-project-id="${id}" autocomplete="off">
        <div class="pray-form-head">
          <strong>${getPrayIcon()} Pray for this request</strong>
          <button type="button" class="btn-link response-close-btn" data-card-pray-close>Close</button>
        </div>
        <p class="pray-form-hint">Take a moment to pray. Leaving a message is optional.</p>
        <div class="pray-form-actions">
          <button type="submit" class="btn btn-pray-submit">${getPrayIcon()} Prayed</button>
          <span class="pray-form-status" data-card-pray-status role="status"></span>
        </div>
        <label class="pray-field">
          <span>Words of encouragement <em>optional</em></span>
          <textarea name="message" rows="3" placeholder="e.g. Praying for strength and peace for you this week."></textarea>
        </label>
        <div class="prayer-name-row"><label class="pray-field">
          <span>Your name <em>optional</em></span><input name="name" placeholder="Anonymous" value="${safeHtml(getDefaultResponderName())}" autocomplete="off">
        </label>
        <label class="prayer-anonymous"><input type="checkbox" name="prayer_anonymous"> Anonymous</label></div>
      </form>
    </div>
  `;
}

function projectCardResponseForm(project) {
  const id = safeHtml(project.id);
  return `
    <div class="project-card-response" data-card-response-panel hidden>
      <div class="project-card-response-head">
        <strong>Respond</strong>
        <button type="button" class="btn-link response-close-btn" data-card-response-close>Close</button>
      </div>
      <form class="simple-form project-card-response-form" data-card-response-form data-project-id="${id}" autocomplete="off">
        <input type="hidden" name="kind" value="reply">
        <select name="type" data-card-reply-type required>
          <option value="">How would you like to help?</option>
          <option value="guidance">Guidance</option>
          <option value="volunteer">Volunteer</option>
          <option value="resources">Resources</option>
          <option value="services">Services</option>
          <option value="mentorship">Mentorship</option>
          <option value="general">General encouragement</option>
        </select>
        <input name="name" placeholder="Your name or Anonymous" autocomplete="off">
        <input name="email" type="email" placeholder="Email (optional)" autocomplete="off" data-card-email>
        <textarea name="message" rows="4" required placeholder="Write your message, offer, guidance, or encouragement"></textarea>
        <div class="project-card-response-actions">
          <button type="submit" class="btn" data-submit-label>Send response</button>
          <span class="muted" data-card-response-status></span>
        </div>
      </form>
    </div>
  `;
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

  const prayed = hasPrayedForRequest(project.id, project.has_prayed);
  const location = [project.country, project.continent].filter(Boolean).map(safeHtml).join(' · ');

  return `
    <article class="card project-card">
      ${shareButton(project, 'share-project-btn-card')}
      <div class="project-meta">
        ${project.category ? `<span class="badge badge-category">${safeHtml(project.category)}</span>` : ''}
        ${location ? `<span class="badge badge-location"><span aria-hidden="true">📍</span> ${location}</span>` : ''}
      </div>
      <div class="project-title-row">
        <h3>${safeHtml(project.title)}</h3>
        ${reviewedIcon}
      </div>
      <p class="project-summary project-summary-clamp">${safeHtml(getProjectDescriptionText(project))}</p>
      ${projectReadMoreLink(project)}
      <p class="project-card-org"><strong>Organization:</strong> ${safeHtml(project.is_anonymous ? 'Anonymous request' : (project.organization_name || 'Not specified'))}</p>
      ${FINANCIAL_SUPPORT_ENABLED && project.needs_financial_support && project.funding_approved ? `
        <div class="progress-wrap">
          <div style="display:flex;justify-content:space-between;gap:12px;">
            <strong>${formatMoney(project.amount_raised)}</strong>
            <span class="muted">Goal ${goalText}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      ` : ''}
      <div class="project-card-footer">
        <div class="project-action-stats">
          ${responseCountBadge(project)}
        </div>
        <div class="project-actions">
          <a class="btn" href="project.html?id=${project.id}">View details</a>
          <button class="btn-pray ${prayed ? 'is-prayed' : ''}" type="button" data-card-pray-toggle aria-expanded="false"${prayed ? ' title="You prayed for this request. Tap to pray again."' : ''}>
            ${getPrayIcon()}<span data-pray-label>Pray</span>
          </button>
          <button class="btn-outline" type="button" data-card-respond-toggle aria-expanded="false">Respond</button>
        </div>
      </div>
      ${projectCardPrayForm(project)}
      ${projectCardResponseForm(project)}
    </article>
  `;
}


function updateProjectReadMoreLinks(scope = document) {
  scope.querySelectorAll('.project-card').forEach((card) => {
    const summary = card.querySelector('.project-summary-clamp');
    const readMore = card.querySelector('.project-read-more');
    if (!summary || !readMore) return;

    window.requestAnimationFrame(() => {
      const isClamped = summary.scrollHeight > summary.clientHeight + 2;
      readMore.hidden = !isClamped;
    });
  });
}

function syncCardResponseForm(form) {
  // The Respond form is reply-only now that prayers have their own Pray button.
  const replyType = form?.querySelector('[data-card-reply-type]');
  if (replyType) {
    replyType.classList.remove('hide');
    replyType.required = true;
  }
}

function incrementCardResponseCount(card) {
  const stat = card?.querySelector('.project-action-stats .badge');
  if (!stat) return;
  const match = stat.textContent.match(/(\d+)/);
  const next = match ? Number(match[1]) + 1 : 1;
  stat.textContent = formatResponseCountLabel(next);
}

function setCardPanelOpen(card, which, open) {
  if (!card) return;
  const prayPanel = card.querySelector('[data-card-pray-panel]');
  const respondPanel = card.querySelector('[data-card-response-panel]');
  const prayToggle = card.querySelector('[data-card-pray-toggle]');
  const respondToggle = card.querySelector('[data-card-respond-toggle]');

  // Only one panel open at a time keeps the card compact.
  if (prayPanel) prayPanel.hidden = !(open && which === 'pray');
  if (respondPanel) respondPanel.hidden = !(open && which === 'respond');

  prayToggle?.setAttribute('aria-expanded', String(open && which === 'pray'));
  prayToggle?.classList.toggle('is-open', open && which === 'pray');
  respondToggle?.setAttribute('aria-expanded', String(open && which === 'respond'));
  respondToggle?.classList.toggle('is-open', open && which === 'respond');

  if (open) {
    const panel = which === 'pray' ? prayPanel : respondPanel;
    const field = panel?.querySelector('textarea[name="message"]');
    window.setTimeout(() => field?.focus(), 50);
  }
}

function initProjectCardResponses(scope = document) {
  const root = scope.querySelector ? scope : document;

  root.querySelectorAll('[data-card-response-form]').forEach(syncCardResponseForm);

  root.querySelectorAll('[data-card-pray-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.project-card');
      const panel = card?.querySelector('[data-card-pray-panel]');
      setCardPanelOpen(card, 'pray', Boolean(panel?.hidden));
    });
  });

  root.querySelectorAll('[data-card-pray-close]').forEach((button) => {
    button.addEventListener('click', () => setCardPanelOpen(button.closest('.project-card'), 'pray', false));
  });

  root.querySelectorAll('[data-card-respond-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.project-card');
      const panel = card?.querySelector('[data-card-response-panel]');
      setCardPanelOpen(card, 'respond', Boolean(panel?.hidden));
    });
  });

  root.querySelectorAll('[data-card-response-close]').forEach((button) => {
    button.addEventListener('click', () => setCardPanelOpen(button.closest('.project-card'), 'respond', false));
  });

  root.querySelectorAll('[data-card-pray-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === '1') return;

      const projectId = form.dataset.projectId;
      const card = form.closest('.project-card');
      const fd = new FormData(form);
      const submitButton = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[data-card-pray-status]');

      form.dataset.submitting = '1';
      if (submitButton) submitButton.disabled = true;
      if (status) status.textContent = 'Sending...';

      try {
        await submitPrayer(projectId, { name: fd.get('name'), message: fd.get('message'), anonymous: fd.get('prayer_anonymous') === 'on' });
        const messageField = form.querySelector('textarea[name="message"]');
        if (messageField) messageField.value = '';
        incrementCardResponseCount(card);

        const toggle = card?.querySelector('[data-card-pray-toggle]');
        toggle?.classList.add('is-prayed');
        toggle?.setAttribute('title', 'You prayed for this request. Tap to pray again.');

        if (status) status.textContent = 'Amen. Thank you for praying.';
        window.setTimeout(() => {
          setCardPanelOpen(card, 'pray', false);
          if (status) status.textContent = '';
        }, 1800);
      } catch (error) {
        if (status) status.textContent = error.message || 'Could not record your prayer.';
      } finally {
        form.dataset.submitting = '0';
        if (submitButton) submitButton.disabled = false;
      }
    });
  });

  root.querySelectorAll('[data-card-response-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === '1') return;

      const projectId = form.dataset.projectId;
      const fd = new FormData(form);
      const kind = 'reply';
      const submitButton = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[data-card-response-status]');
      const originalText = submitButton?.textContent || 'Send response';

      form.dataset.submitting = '1';
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Sending...';
      }
      if (status) status.textContent = 'Sending your response...';

      try {
        const result = await api(`/projects/${projectId}/respond`, {
          method: 'POST',
          body: JSON.stringify({
            kind,
            type: kind === 'reply' ? (fd.get('type') || 'general') : '',
            name: fd.get('name') || 'Anonymous',
            email: fd.get('email'),
            message: fd.get('message')
          })
        });

        trackEvent('project_response_submitted', {
          project_id: projectId,
          kind,
          reply_type: kind === 'reply' ? String(fd.get('type') || 'general') : '',
          page_path: window.location.pathname
        });
        trackEvent(kind === 'prayer' ? 'prayer_submitted' : 'reply_submitted', {
          project_id: projectId,
          reply_type: kind === 'reply' ? String(fd.get('type') || 'general') : '',
          page_path: window.location.pathname
        });

        form.reset();
        syncCardResponseForm(form);
        if (status) status.textContent = result?.message || 'Your response has been sent.';
        incrementCardResponseCount(form.closest('.project-card'));
      } catch (error) {
        if (status) status.textContent = error.message || 'Could not send response.';
        else alert(error.message);
      } finally {
        form.dataset.submitting = '0';
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalText;
        }
      }
    });
  });
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

    updateProjectReadMoreLinks(grid);
    initProjectCardResponses(grid);

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
              ${responseCountBadge(project)}
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
    id: item.id,
    deleteKind: 'prayers',
    kind: 'Prayer',
    name: item.name || 'Anonymous',
    message: item.message || '',
    typeLabel: 'Prayer',
    createdAt: item.created_at || item.createdAt || ''
  }));

  const replyItems = replies.map(item => ({
    id: item.id,
    deleteKind: 'replies',
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

/* ===== Request Details page ===== */
function formatFriendlyDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatRelativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatFriendlyDate(value);
}

function getInitials(name) {
  const parts = String(name || 'A').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function renderDetailResponseItem(item, canManage) {
  const isPrayer = item.kind === 'Prayer';
  const hasMessage = Boolean(String(item.message || '').trim());
  return `
    <li class="pd-response ${isPrayer ? 'is-prayer' : 'is-reply'}">
      <span class="pd-avatar" aria-hidden="true">${isPrayer && !hasMessage ? '🙏' : safeHtml(getInitials(item.name))}</span>
      <div class="pd-response-body">
        <div class="pd-response-head">
          <strong>${safeHtml(item.name)}</strong>
          <span class="pd-tag ${isPrayer ? 'pd-tag-prayer' : ''}">${safeHtml(item.typeLabel)}</span>
          ${item.createdAt ? `<time class="pd-response-time" datetime="${safeHtml(item.createdAt)}">${safeHtml(formatRelativeTime(item.createdAt))}</time>` : ''}
          ${canManage && item.id ? `<button class="pd-icon-btn response-delete-btn" type="button" data-response-kind="${safeHtml(item.deleteKind)}" data-response-id="${safeHtml(item.id)}" aria-label="Delete ${safeHtml(item.kind)}" title="Delete ${safeHtml(item.kind)}">🗑️</button>` : ''}
        </div>
        ${hasMessage
          ? `<p class="pd-response-message">${safeHtml(item.message)}</p>`
          : `<p class="pd-response-message is-silent">${isPrayer ? 'Prayed for this request' : ''}</p>`}
      </div>
    </li>
  `;
}

async function loadProjectDetails() {
  const root = $('#projectDetails');
  if (!root) return;

  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    root.innerHTML = '<div class="pd-card"><p>Missing request id.</p></div>';
    return;
  }

  root.innerHTML = '<div class="pd-card pd-loading"><p>Loading request...</p></div>';

  try {
    const data = await api(`/projects/${id}`);
    const { project, prayers = [], replies = [], updates = [], stats = {}, response_visibility, viewer = {} } = data;

    trackOnce(`project_view:${id}`, 'project_view', {
      project_id: id,
      category: project.category || '',
      country: project.country || '',
      help_types: Array.isArray(project.help_types) ? project.help_types.join(',') : '',
      needs_financial_support: Boolean(project.needs_financial_support)
    });

    if (project.title) document.title = `${project.title} | ChristHelper`;

    const pct = project.funding_goal > 0
      ? Math.min(100, Math.round((project.amount_raised / project.funding_goal) * 100))
      : 0;
    const donationAvailable = FINANCIAL_SUPPORT_ENABLED && project.needs_financial_support && project.funding_approved && project.owner_can_receive_payments;
    const canManageResponses = Boolean(currentUser && (currentUser.id === project.created_by || currentUser.role === 'admin'));
    const goalText = project.funding_goal_currency === 'USD'
      ? formatUsd(project.funding_goal)
      : formatMoney(project.funding_goal);
    const responsesVisible = response_visibility?.showing_responses !== false;
    const combined = buildCombinedResponses(prayers, replies);
    let prayerCount = Number(stats.prayer_count || 0);
    let replyCount = Number(stats.reply_count || 0);
    const prayed = hasPrayedForRequest(id, viewer.has_prayed);
    const isReviewed = project.admin_reviewed || !project.needs_financial_support;
    const organization = project.is_anonymous ? 'Anonymous request' : (project.organization_name || '');
    const place = project.is_online ? 'Online' : [project.city, project.country].filter(Boolean).join(', ');
    const whyItMatters = String(project.why_it_matters || '').trim();
    const links = Array.isArray(project.project_links) ? project.project_links.filter(Boolean) : [];

    const facts = [
      organization ? { label: 'Organization', value: safeHtml(organization) } : null,
      place ? { label: 'Location', value: safeHtml(place) + (project.continent ? ` <span class="pd-fact-sub">${safeHtml(project.continent)}</span>` : '') } : null,
      project.category ? { label: 'Category', value: safeHtml(project.category) } : null,
      project.campaign_expiry_date ? { label: 'Campaign ends', value: safeHtml(formatFriendlyDate(project.campaign_expiry_date)) } : null
    ].filter(Boolean);

    root.innerHTML = `
      <div class="pd">
        <a class="pd-back" href="explore-projects.html"><span aria-hidden="true">←</span> All requests</a>

        <header class="pd-hero">
          ${shareButton(project, 'share-project-btn-detail')}
          <div class="pd-eyebrow">
            ${project.category ? `<span class="pd-chip pd-chip-strong">${safeHtml(project.category)}</span>` : ''}
            ${place ? `<span class="pd-chip"><span aria-hidden="true">📍</span> ${safeHtml(place)}</span>` : ''}
            ${project.verified_ministry ? '<span class="pd-chip pd-chip-good">✓ Verified church/ministry</span>' : ''}
            ${project.is_anonymous ? '<span class="pd-chip">Anonymous</span>' : ''}
          </div>
          <div class="pd-title-row">
            <h1>${safeHtml(project.title)}</h1>
            ${isReviewed ? '<span class="review-status-icon review-status-icon-lg" title="Visible" aria-label="Visible">✓</span>' : ''}
          </div>
          <p class="pd-byline">
            ${organization ? `<span>${safeHtml(organization)}</span>` : ''}
            ${project.created_at ? `<span>Posted ${safeHtml(formatFriendlyDate(project.created_at))}</span>` : ''}
          </p>

          <div class="pd-stats">
            <div class="pd-stat"><strong data-pd-prayer-count>${prayerCount}</strong><span>${prayerCount === 1 ? 'Prayer' : 'Prayers'}</span></div>
            <div class="pd-stat"><strong data-pd-reply-count>${replyCount}</strong><span>${replyCount === 1 ? 'Reply' : 'Replies'}</span></div>
            ${FINANCIAL_SUPPORT_ENABLED && project.needs_financial_support && project.funding_approved ? `
              <div class="pd-stat"><strong>${formatMoney(project.amount_raised)}</strong><span>of ${goalText}</span></div>
            ` : ''}
          </div>

          <div class="pd-hero-actions">
            <button type="button" class="btn-pray btn-pray-lg ${prayed ? 'is-prayed' : ''}" data-pd-jump="pray">${getPrayIcon()}<span data-pray-label>${prayed ? 'Prayed - pray again' : 'Pray for this'}</span></button>
            <button type="button" class="pd-btn-secondary" data-pd-jump="respond"><span aria-hidden="true">💬</span> Respond</button>
            ${donationAvailable ? '<button type="button" class="pd-btn-secondary" data-pd-jump="support"><span aria-hidden="true">💛</span> Give</button>' : ''}
          </div>
        </header>

        <div class="pd-layout">
          <section class="pd-card pd-about" aria-labelledby="pdAboutTitle">
            <h2 id="pdAboutTitle">About this request</h2>
            <div class="pd-description">${safeHtml(getProjectDescriptionText(project))}</div>

            ${whyItMatters ? `
              <div class="pd-why">
                <h3>Why it matters</h3>
                <p>${safeHtml(whyItMatters)}</p>
              </div>
            ` : ''}

            ${(project.help_types || []).filter(h => !isFinancialType(h)).length ? `
              <div class="pd-help">
                <h3>How you can help</h3>
                <div class="pd-chip-row">
                  ${(project.help_types || []).filter(h => !isFinancialType(h)).map(h => `<span class="pd-chip">${safeHtml(h)}</span>`).join('')}
                </div>
              </div>
            ` : ''}

            ${facts.length ? `
              <dl class="pd-facts">
                ${facts.map(f => `<div class="pd-fact"><dt>${f.label}</dt><dd>${f.value}</dd></div>`).join('')}
              </dl>
            ` : ''}

            ${links.length ? `
              <div class="pd-links">
                <h3>Links</h3>
                <ul>
                  ${links.map(link => `<li><a href="${safeHtml(link)}" target="_blank" rel="noopener noreferrer">${safeHtml(link)}</a></li>`).join('')}
                </ul>
              </div>
            ` : ''}
          </section>

          <aside class="pd-side">
            <section class="pd-card pd-pray-card" id="pray" aria-labelledby="pdPrayTitle">
              <div class="pd-pray-head">
                <span class="pd-pray-badge" aria-hidden="true">🙏</span>
                <div>
                  <h2 id="pdPrayTitle">Pray for this request</h2>
                  <p>Pray now and let them know. A message is optional.</p>
                </div>
              </div>
              <form id="prayForm" class="pd-form" autocomplete="off">
                <button type="submit" class="btn btn-pray-submit pd-full">${getPrayIcon()} Prayed</button>
                <p class="pd-form-status" id="prayStatus" role="status"></p>
                <label class="pd-field">
                  <span>Words of encouragement <em>optional</em></span>
                  <textarea name="message" rows="3" placeholder="e.g. Praying for peace and provision for you."></textarea>
                </label>
                <div class="prayer-name-row"><label class="pd-field">
                  <span>Your name <em>optional</em></span><input name="name" placeholder="Anonymous" value="${safeHtml(getDefaultResponderName())}">
        </label>
        <label class="prayer-anonymous"><input type="checkbox" name="prayer_anonymous"> Anonymous</label></div>
              </form>
            </section>

            <section class="pd-card" id="respond" aria-labelledby="pdRespondTitle">
              <h2 id="pdRespondTitle">Respond</h2>
              <p class="pd-card-sub">Offer guidance, your time, resources or encouragement.</p>
              <form id="respondForm" class="pd-form">
                <input type="hidden" name="kind" value="reply">
                <select name="type" id="responseSupportType" required>
                  <option value="">How would you like to help?</option>
                  <option>Guidance</option>
                  <option>Volunteer</option>
                  <option>Mentorship</option>
                  <option>Services</option>
                  <option>Encouragement</option>
                </select>
                <input name="name" placeholder="Your name${token ? '' : ' (optional)'}">
                <input name="email" id="responseEmail" type="email" placeholder="Your email (optional)">
                <textarea name="message" id="responseMessage" rows="4" placeholder="Write your message, offer, guidance, or encouragement" required></textarea>
                <button class="btn pd-full" type="submit">Send response</button>
                <p class="pd-form-status" id="respondStatus" role="status"></p>
              </form>
            </section>

            ${project.needs_financial_support ? `<p class="pd-card">${FINANCIAL_SUPPORT_NOTICE}</p>` : ''}
          </aside>

          <div class="pd-main">
            <section class="pd-card" id="responses" aria-labelledby="pdResponsesTitle">
              <div class="pd-card-head">
                <h2 id="pdResponsesTitle">Community responses</h2>
                ${responsesVisible ? `<span class="pd-count" data-pd-total-count>${prayerCount + replyCount}</span>` : ''}
              </div>
              ${!responsesVisible
                ? '<p class="pd-empty">Prayers and replies are private for this request. Only the request creator can view them.</p>'
                : `<ul id="responseList" class="pd-responses">
                    ${combined.length
                      ? combined.map(item => renderDetailResponseItem(item, canManageResponses)).join('')
                      : '<li class="pd-empty" data-pd-empty>No responses yet. Be the first to pray.</li>'}
                  </ul>`}
            </section>

            <section class="pd-card" aria-labelledby="pdUpdatesTitle">
              <h2 id="pdUpdatesTitle">Updates</h2>
              ${updates.length ? `
                <ol class="pd-timeline">
                  ${updates.map(item => `
                    <li>
                      <time datetime="${safeHtml(item.created_at || '')}">${safeHtml(formatFriendlyDate(item.created_at))}</time>
                      <strong>${safeHtml(item.title)}</strong>
                      <p>${safeHtml(item.content)}</p>
                    </li>
                  `).join('')}
                </ol>
              ` : '<p class="pd-empty">No updates yet.</p>'}
            </section>

            <div class="pd-report">
              <button type="button" class="pd-report-toggle" id="reportToggle" aria-expanded="false" aria-controls="reportPanel">
                <span aria-hidden="true">⚑</span> Report this request
              </button>
              <div class="pd-report-panel" id="reportPanel" hidden>
                <form id="reportForm" class="pd-form">
                  <p class="pd-card-sub">Tell us what's wrong. Reports are reviewed by the ChristHelper team.</p>
                  <select name="reason" required>
                    <option value="">Select a reason</option>
                    <option>Suspicious or misleading request</option>
                    <option>False information</option>
                    <option>Inappropriate content</option>
                    <option>Other safety concern</option>
                  </select>
                  <textarea name="details" rows="3" placeholder="Extra details (optional)"></textarea>
                  <div class="pd-report-actions">
                    <button class="pd-btn-secondary" type="submit">Submit report</button>
                    <button class="btn-link" type="button" id="reportCancel">Cancel</button>
                  </div>
                  <p class="pd-form-status" id="reportStatus" role="status"></p>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    /* --- counts + list helpers --- */
    function refreshCounts() {
      const p = root.querySelector('[data-pd-prayer-count]');
      const r = root.querySelector('[data-pd-reply-count]');
      const t = root.querySelector('[data-pd-total-count]');
      if (p) {
        p.textContent = prayerCount;
        p.nextElementSibling.textContent = prayerCount === 1 ? 'Prayer' : 'Prayers';
      }
      if (r) {
        r.textContent = replyCount;
        r.nextElementSibling.textContent = replyCount === 1 ? 'Reply' : 'Replies';
      }
      if (t) t.textContent = prayerCount + replyCount;
    }

    function prependResponse(kind, item) {
      const list = $('#responseList');
      if (!list || !item) return;
      list.querySelector('[data-pd-empty]')?.remove();
      const [entry] = buildCombinedResponses(kind === 'prayer' ? [item] : [], kind === 'reply' ? [item] : []);
      if (entry) list.insertAdjacentHTML('afterbegin', renderDetailResponseItem(entry, canManageResponses));
    }

    function markPrayed() {
      const heroPray = root.querySelector('.pd-hero [data-pd-jump="pray"]');
      heroPray?.classList.add('is-prayed');
      const label = heroPray?.querySelector('[data-pray-label]');
      if (label) label.textContent = 'Prayed - pray again';
    }

    /* --- hero jump buttons --- */
    $all('[data-pd-jump]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.dataset.pdJump);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('is-highlighted');
        window.setTimeout(() => target.classList.remove('is-highlighted'), 1400);
        const field = target.querySelector('textarea, input:not([type="radio"])');
        window.setTimeout(() => field?.focus({ preventScroll: true }), 450);
      });
    });

    /* --- pray form --- */
    const prayForm = $('#prayForm');
    prayForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (prayForm.dataset.submitting === '1') return;
      const fd = new FormData(prayForm);
      const submitButton = prayForm.querySelector('button[type="submit"]');
      const status = $('#prayStatus');

      prayForm.dataset.submitting = '1';
      if (submitButton) submitButton.disabled = true;
      if (status) status.textContent = 'Sending...';

      try {
        const result = await submitPrayer(id, { name: fd.get('name'), message: fd.get('message'), anonymous: fd.get('prayer_anonymous') === 'on' });
        prayerCount += 1;
        refreshCounts();
        if (!result?.duplicate) prependResponse('prayer', result?.item);
        markPrayed();
        const messageField = prayForm.querySelector('textarea[name="message"]');
        if (messageField) messageField.value = '';
        if (status) status.textContent = 'Amen. Thank you for praying.';
      } catch (error) {
        if (status) status.textContent = error.message || 'Could not record your prayer.';
      } finally {
        prayForm.dataset.submitting = '0';
        if (submitButton) submitButton.disabled = false;
      }
    });

    /* --- respond form --- */
    const respondForm = $('#respondForm');

    respondForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (respondForm.dataset.submitting === '1') return;
      const fd = new FormData(respondForm);
      const kind = 'reply';
      const submitButton = respondForm.querySelector('button[type="submit"]');
      const originalSubmitText = submitButton?.textContent || 'Send response';
      const status = $('#respondStatus');

      respondForm.dataset.submitting = '1';
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Sending...';
      }

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

        if (kind === 'prayer') {
          prayerCount += 1;
          rememberPrayedRequest(id);
          markPrayed();
        } else {
          replyCount += 1;
        }
        refreshCounts();
        if (!result?.duplicate) prependResponse(kind === 'prayer' ? 'prayer' : 'reply', result?.item);

        respondForm.reset();
        if (status) status.textContent = result?.message || 'Your response has been sent.';
      } catch (error) {
        if (status) status.textContent = error.message || 'Could not send your response.';
      } finally {
        respondForm.dataset.submitting = '0';
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalSubmitText;
        }
      }
    });

    /* --- delete responses (owner/admin) --- */
    $('#responseList')?.addEventListener('click', async (event) => {
      const button = event.target.closest('.response-delete-btn');
      if (!button) return;
      const responseId = button.dataset.responseId;
      const responseKind = button.dataset.responseKind;
      if (!responseId || !responseKind) return;
      if (!confirm('Delete this prayer/reply?')) return;

      try {
        await api(`/projects/${id}/${responseKind}/${responseId}`, { method: 'DELETE' });
        button.closest('.pd-response')?.remove();
        if (responseKind === 'prayers') prayerCount = Math.max(0, prayerCount - 1);
        else replyCount = Math.max(0, replyCount - 1);
        refreshCounts();
        const list = $('#responseList');
        if (list && !list.querySelector('.pd-response')) {
          list.innerHTML = '<li class="pd-empty" data-pd-empty>No responses yet. Be the first to pray.</li>';
        }
      } catch (error) {
        alert(error.message);
      }
    });

    /* --- collapsible report --- */
    const reportToggle = $('#reportToggle');
    const reportPanel = $('#reportPanel');
    function setReportOpen(open) {
      if (!reportPanel || !reportToggle) return;
      reportPanel.hidden = !open;
      reportToggle.setAttribute('aria-expanded', String(open));
      reportToggle.classList.toggle('is-open', open);
      if (open) window.setTimeout(() => reportPanel.querySelector('select')?.focus(), 30);
    }
    reportToggle?.addEventListener('click', () => setReportOpen(reportPanel?.hidden));
    $('#reportCancel')?.addEventListener('click', () => setReportOpen(false));

    $('#reportForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const status = $('#reportStatus');
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      try {
        await api(`/projects/${id}/report`, { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
        trackEvent('project_report_submitted', { project_id: id, page_path: window.location.pathname });
        form.reset();
        if (status) status.textContent = 'Thank you. Your report was submitted.';
        window.setTimeout(() => {
          setReportOpen(false);
          if (status) status.textContent = '';
        }, 2200);
      } catch (error) {
        if (status) status.textContent = error.message || 'Could not submit the report.';
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });

    /* --- donations --- */
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

    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) window.setTimeout(() => target.scrollIntoView({ block: 'start' }), 60);
    }
  } catch (error) {
    root.innerHTML = `<div class="pd-card"><p>${safeHtml(error.message)}</p></div>`;
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
        window.location.href = appPath(`verify-email.html?email=${encodeURIComponent(data.email || payload.email || '')}${new URLSearchParams(window.location.search).get('next') === 'submit' ? '&next=submit' : ''}`);
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
        window.location.href = appPath(new URLSearchParams(window.location.search).get('next') === 'submit' && getPendingSubmitRequest() ? 'submit.html?resume=1' : 'profile.html');
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
        window.location.href = appPath(new URLSearchParams(window.location.search).get('next') === 'submit' && getPendingSubmitRequest() ? 'submit.html?resume=1' : 'profile.html');
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

function isStripeReadyForFinancialSupport() {
  return Boolean(currentUser?.stripe_account_id && currentUser?.stripe_charges_enabled);
}

function toggleFinancialFields() {
  const selected = Array.from(document.querySelectorAll('[name="help_types"], [name="category"]')).some(input => (input.checked || input.tagName === 'SELECT') && isFinancialType(input.value));
  const notice = $('#financialSupportNotice');
  if (notice) notice.classList.toggle('hide', !selected);
}

function syncAnonymousOption() {
  const input = $('#submitAnonymousOption');
  if (input) input.disabled = false;
}

function syncCampaignExpiry() {
  const enabled = Boolean($('#enableCampaignExpiry')?.checked);
  $('#campaignExpiryWrap')?.classList.toggle('hide', !enabled);
  const input = $('#campaignExpiryDate');
  if (input) {
    input.disabled = !enabled;
    input.required = enabled;
    if (!enabled) input.value = '';
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


const PENDING_SUBMIT_REQUEST_KEY = 'christhelper.pendingSubmitRequest';

function getSubmitRequestPayload(form) {
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd);

  payload.is_online = fd.get('is_online') === 'on';
  payload.is_anonymous = fd.get('is_anonymous') === 'on';
  payload.responses_public = fd.get('responses_public') !== null;
  payload.help_types = fd.getAll('help_types').filter(value => !isFinancialType(value));
  payload.needs_financial_support = false;
  payload.category = payload.category || 'Other';
  payload.campaign_expiry_date = fd.get('campaign_expiry_date') || '';
  payload.project_links = parseProjectLinks(payload.project_links);
  payload.continent = payload.continent || detectContinentFromCountry(payload.country);
  payload.summary = payload.description || payload.summary || '';
  delete payload.why_it_matters;

  if (payload.needs_financial_support) {
    payload.funding_goal_currency = 'USD';
    payload.is_anonymous = false;
  } else {
    payload.funding_goal = payload.funding_goal || 0;
    payload.funding_goal_currency = '';
  }

  return payload;
}

function savePendingSubmitRequest(payload) {
  localStorage.setItem(PENDING_SUBMIT_REQUEST_KEY, JSON.stringify({
    payload,
    saved_at: new Date().toISOString()
  }));
}

function getPendingSubmitRequest() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_SUBMIT_REQUEST_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function clearPendingSubmitRequest() {
  localStorage.removeItem(PENDING_SUBMIT_REQUEST_KEY);
}

function showSubmitAuthModal(payload) {
  savePendingSubmitRequest(payload);
  const modal = $('#submitAuthModal');
  if (!modal) {
    alert('Please sign up or log in to submit your request. Your request details were saved in this browser.');
    window.location.href = appPath('login.html?next=submit');
    return;
  }

  modal.classList.remove('hide');
  const signup = $('#submitAuthSignup');
  const login = $('#submitAuthLogin');
  if (signup) signup.href = appPath('register.html?next=submit');
  if (login) login.href = appPath('login.html?next=submit');
}

function initSubmitAuthModal() {
  const modal = $('#submitAuthModal');
  if (!modal) return;
  modal.querySelectorAll('[data-submit-auth-close]').forEach((el) => {
    el.addEventListener('click', () => modal.classList.add('hide'));
  });
}

function validateSubmitPayloadBeforePost(payload) {
  // Also normalize drafts saved before platform payments were disabled.
  payload.help_types = (payload.help_types || []).filter(value => !isFinancialType(value));
  payload.needs_financial_support = false;
  payload.funding_goal = 0;
  payload.funding_goal_currency = '';
  payload.category = payload.category || 'Other';
  return true;
}

async function submitRequestPayload(payload, form = null) {
  if (!validateSubmitPayloadBeforePost(payload)) return;

  const data = await api('/projects', { method: 'POST', body: JSON.stringify(payload) });
  trackEvent('project_created', {
    category: payload.category || '',
    country: payload.country || '',
    is_online: Boolean(payload.is_online),
    needs_financial_support: Boolean(payload.needs_financial_support),
    help_types: Array.isArray(payload.help_types) ? payload.help_types.join(',') : '',
    page_path: window.location.pathname
  });

  clearPendingSubmitRequest();
  alert(payload.needs_financial_support
    ? 'Request submitted successfully. Your financial request is waiting for admin review.'
    : 'Request submitted successfully.');

  if (form) {
    form.reset();
    syncCampaignExpiry();
    buildCountryDropdown();
    fillContinentFromCountry();
    toggleFinancialFields();
  }

  const projectId = data?.id || data?.project?.id;
  window.location.href = appPath(projectId ? `project.html?id=${encodeURIComponent(projectId)}` : 'profile.html');
}

async function resumePendingSubmitRequestIfNeeded() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('resume') !== '1') return;
  if (!token) return;

  const pending = getPendingSubmitRequest();
  if (!pending?.payload) return;

  try {
    await submitRequestPayload(pending.payload);
  } catch (error) {
    alert(error.message);
  }
}

function handleSubmitProject() {
  const form = $('#submitProjectForm');
  if (!form) return;

  buildCountryDropdown();
  renderSubmitInfoIcons();
  fillContinentFromCountry();
  toggleFinancialFields();
  setSubmitMinDate();
  syncCampaignExpiry();
  $('#enableCampaignExpiry')?.addEventListener('change', syncCampaignExpiry);
  loadAllProjectsForSubmitPage();
  form.querySelector('[name="category"]')?.addEventListener('change', toggleFinancialFields);

  const countryEl = $('#projectCountry') || $('[name="country"]');
  countryEl?.addEventListener('change', fillContinentFromCountry);
  countryEl?.addEventListener('blur', fillContinentFromCountry);

  Array.from(document.querySelectorAll('input[name="help_types"]')).forEach((el) => {
    el.addEventListener('change', toggleFinancialFields);
  });

  initSubmitAuthModal();
  resumePendingSubmitRequestIfNeeded();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = getSubmitRequestPayload(form);



    if (!token) {
      showSubmitAuthModal(payload);
      return;
    }

    try {
      await submitRequestPayload(payload, form);
    } catch (error) {
      if (error.message.includes('Missing token')) {
        showSubmitAuthModal(payload);
        return;
      }
      alert(error.message);
    }
  });
}

// Platform donations are independent of disabled financial support for requests.
function handlePlatformDonation() {
  const form = $('#platformDonationForm');
  if (!form) return;

  // Quick-pick amount chips (Get Involved page)
  const amountInput = form.querySelector('[name="amount_platform"]');
  const chips = Array.from(form.querySelectorAll('[data-amount]'));
  const syncChips = () => {
    const value = Number(amountInput ? amountInput.value : 0);
    let matched = false;
    chips.forEach((chip) => {
      const chipValue = chip.dataset.amount;
      const isMatch = chipValue !== '' && Number(chipValue) === value;
      if (isMatch) matched = true;
      chip.classList.toggle('is-selected', isMatch);
      chip.setAttribute('aria-pressed', String(isMatch));
    });
    const other = chips.find((chip) => chip.dataset.amount === '');
    if (other && !matched && amountInput && amountInput.value !== '') {
      other.classList.add('is-selected');
      other.setAttribute('aria-pressed', 'true');
    }
  };
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!amountInput) return;
      if (chip.dataset.amount === '') {
        amountInput.value = '';
        chips.forEach((c) => { c.classList.toggle('is-selected', c === chip); c.setAttribute('aria-pressed', String(c === chip)); });
        amountInput.focus();
        return;
      }
      amountInput.value = chip.dataset.amount;
      syncChips();
    });
  });
  if (amountInput) amountInput.addEventListener('input', syncChips);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (amountInput && !(Number(amountInput.value) >= 1)) {
      amountInput.setCustomValidity('Please enter an amount of at least NZ$1.');
      amountInput.reportValidity();
      amountInput.setCustomValidity('');
      return;
    }
    const emailInput = form.querySelector('[name="donor_email"]');
    if (emailInput && emailInput.value && !emailInput.checkValidity()) {
      emailInput.reportValidity();
      return;
    }
    const payload = Object.fromEntries(new FormData(form));
    try {
      trackEvent('platform_support_started', {
        currency: 'NZD',
        amount_platform: Number(payload.amount_platform || payload.amount || 0),
        page_path: window.location.pathname
      });
      trackEvent('payment_started', {
        flow_type: 'platform',
        currency: 'NZD',
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
        <h2>Stripe Earnings</h2>
        <p class="muted">Connect Stripe first to view your balance, recent transactions, and payouts.</p>
      </section>
    `;
  }

  if (!summary) {
    return `
      <section class="card panel">
        <h2>Stripe Earnings</h2>
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
      <h2>Stripe Earnings</h2>
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
                  <td>${safeHtml(item.status || '-')}</td>
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
                  <td>${safeHtml(item.status || '-')}</td>
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
                  <td>${safeHtml(item.stripe_payment_intent_id || '-')}</td>
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
  if (!FINANCIAL_SUPPORT_ENABLED) return;
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
    exclude_closed_projects: Boolean(user?.exclude_closed_projects),
    receive_engagement_emails: user?.receive_engagement_emails !== false
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
              
              
              ${responseCountBadge(project)}
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
    const { user, projects } = await api('/profile');
    const mergedUser = user;
    setStoredAuth(token, mergedUser);
    setAuthUi();

    const stripeReady = Boolean(mergedUser?.stripe_charges_enabled);
    const stripeConnected = Boolean(mergedUser?.stripe_account_id);

    const prefs = normalizeProfilePreferences(mergedUser);

    root.innerHTML = `
      <section class="card page-card">
        <div class="eyebrow">My profile</div>
        <h1 style="font-size:2.3rem;">Welcome, ${safeHtml(mergedUser?.name || '')}</h1>
        <p>Manage your account details and request preferences.</p>

        <div class="stack profile-sequential-stack">
            <section class="card panel">
              <h2>Personal Details</h2>
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
              <h2>Preferences</h2>
              <div class="form-grid">
                <label class="checkbox-field">
                  <input type="checkbox" id="showEmailPublicly" ${prefs.show_email_publicly ? 'checked' : ''}>
                  <span>Show my email publicly on projects</span>
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

                <label class="checkbox-field">
                  <input type="checkbox" id="receiveEngagementEmails" ${prefs.receive_engagement_emails ? 'checked' : ''}>
                  <span>Receive twice-weekly prayer request emails</span>
                </label>
              </div>

              <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;">
                <button class="btn" id="savePreferencesBtn" type="button">Save preferences</button>
              </div>
            </section>

            <section class="card panel">
              <h2>Account Options</h2>
              <div style="display:flex;gap:12px;flex-wrap:wrap;">
                <button class="btn-outline" id="downloadDataBtn" type="button">Download my data</button>
                <button class="btn-outline" id="changePasswordBtn" type="button">Change password</button>
                <button class="btn-outline" id="deactivateAccountBtn" type="button">Deactivate account</button>
              </div>
            </section>

            <section class="card panel">
              <h2>My Requests</h2>
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
        allow_financial_support: prefs.allow_financial_support,
        allow_prayer_requests: $('#allowPrayerRequests')?.checked || false,
        allow_replies: $('#allowReplies')?.checked || false,
        hide_archived_projects: $('#hideArchivedProjects')?.checked || false,
        exclude_closed_projects: $('#excludeClosedProjects')?.checked || false,
        receive_engagement_emails: $('#receiveEngagementEmails')?.checked !== false
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

    $('#connectStripeNoticeBtn')?.addEventListener('click', () => $('#connectStripeBtn')?.click());

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


function handleFeedbackForm() {
  const form = $('#feedbackForm');
  if (!form) return;

  const statusEl = $('#feedbackStatus');
  const submitBtn = $('#feedbackSubmitBtn');
  const params = new URLSearchParams(window.location.search);
  const requestIdInput = form.querySelector('[name="request_id"]');
  if (requestIdInput && params.get('request_id')) requestIdInput.value = params.get('request_id');

  if (currentUser) {
    const nameInput = form.querySelector('[name="name"]');
    const emailInput = form.querySelector('[name="email"]');
    if (nameInput && !nameInput.value) nameInput.value = currentUser.name || '';
    if (emailInput && !emailInput.value) emailInput.value = currentUser.email || '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) {
      statusEl.textContent = 'Sending...';
      statusEl.classList.remove('is-success', 'is-error');
    }

    const formData = new FormData(form);
    const payload = {
      name: String(formData.get('name') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      type: String(formData.get('type') || 'Other').trim(),
      message: String(formData.get('message') || '').trim(),
      request_id: String(formData.get('request_id') || '').trim()
    };

    try {
      const data = await api('/feedback', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      form.reset();
      if (statusEl) {
        statusEl.textContent = data.message || 'Thanks! Your feedback has been sent.';
        statusEl.classList.remove('is-error');
        statusEl.classList.add('is-success');
      }
      trackEvent('feedback_submitted', { feedback_type: payload.type, has_request_id: Boolean(payload.request_id) });
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = error.message || 'Unable to send feedback.';
        statusEl.classList.remove('is-success');
        statusEl.classList.add('is-error');
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}


function handleVolunteerForm() {
  const form = $('#volunteerForm');
  if (!form) return;

  const statusEl = $('#volunteerStatus');
  const submitBtn = $('#volunteerSubmitBtn');
  const setStatus = (text, state) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('is-success', state === 'success');
    statusEl.classList.toggle('is-error', state === 'error');
  };

  if (currentUser) {
    const nameInput = form.querySelector('[name="name"]');
    const emailInput = form.querySelector('[name="email"]');
    const countryInput = form.querySelector('[name="country"]');
    if (nameInput && !nameInput.value) nameInput.value = currentUser.name || '';
    if (emailInput && !emailInput.value) emailInput.value = currentUser.email || '';
    if (countryInput && !countryInput.value) countryInput.value = currentUser.country || '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const formData = new FormData(form);
    const areas = formData.getAll('areas').map((v) => String(v).trim()).filter(Boolean);
    const country = String(formData.get('country') || '').trim();
    const availability = String(formData.get('availability') || '').trim();
    const about = String(formData.get('about') || '').trim();

    const message = [
      'VOLUNTEER APPLICATION',
      `Areas of interest: ${areas.length ? areas.join(', ') : 'Not specified'}`,
      `Availability: ${availability || 'Not specified'}`,
      `Country: ${country || 'Not specified'}`,
      '',
      'About:',
      about
    ].join('\n');

    const payload = {
      name: String(formData.get('name') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      type: 'Volunteer Application',
      message,
      request_id: ''
    };

    if (submitBtn) submitBtn.disabled = true;
    setStatus('Sending...', '');

    try {
      await api('/feedback', { method: 'POST', body: JSON.stringify(payload) });
      form.reset();
      setStatus('Thank you for offering to serve! We will be in touch by email soon.', 'success');
      trackEvent('volunteer_application_submitted', { areas_count: areas.length, availability });
    } catch (error) {
      setStatus(error.message || 'Unable to send your application. Please try again.', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function initFooterYear() {
  const year = String(new Date().getFullYear());
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = year; });
}


let adminProjectsCache = [];
let adminDonationsCache = [];
let adminUsersCache = [];
let adminFeedbackCache = [];

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

function formatAdminYesNo(value) {
  return value ? 'Yes' : 'No';
}

function adminDetailItem(label, value, options = {}) {
  const isFull = options.full ? ' full' : '';
  const renderedValue = value === undefined || value === null || String(value).trim() === '' ? '-' : value;
  return `
    <div class="admin-detail-item${isFull}">
      <span class="admin-detail-label">${safeHtml(label)}</span>
      <div class="admin-detail-value">${options.html ? renderedValue : safeHtml(renderedValue)}</div>
    </div>
  `;
}

function getAdminProjectById(id) {
  return (adminProjectsCache || []).find((project) => String(project.id) === String(id));
}

function renderAdminProjectDetails(project) {
  if (!project) return '<p>Request not found.</p>';
  const fundingGoal = project.funding_goal || project.goal_amount || project.target_amount || project.amount_needed;
  const createdBy = project.created_by || project.user_id || '';
  const publicUrl = `${window.location.origin}/project.html?id=${encodeURIComponent(project.id)}`;

  return `
    <div class="admin-detail-grid">
      ${adminDetailItem('ID', project.id)}
      ${adminDetailItem('Created', formatIsoDateTime(project.created_at))}
      ${adminDetailItem('Title', project.title, { full: true })}
      ${adminDetailItem('Requester / organization', project.organization_name || project.requester_name || '-')}
      ${adminDetailItem('Created by user ID', createdBy)}
      ${adminDetailItem('Country', project.country)}
      ${adminDetailItem('Continent', project.continent)}
      ${adminDetailItem('Category', project.category)}
      ${adminDetailItem('Help type', project.help_type || project.support_type || project.type)}
      ${adminDetailItem('Status', getAdminProjectStatusBadge(project), { html: true })}
      ${adminDetailItem('Reviewed', getAdminReviewedBadge(project), { html: true })}
      ${adminDetailItem('Verified ministry', formatAdminYesNo(project.verified_ministry))}
      ${adminDetailItem('Campaign expiry date', project.campaign_expiry_date || project.expires_at || '-')}
      ${adminDetailItem('Prayer/reply count', project.prayer_count ?? project.responses_count ?? project.response_count ?? '-')}
      ${adminDetailItem('Description', project.description || project.summary || '-', { full: true })}
      ${project.denied_reason ? adminDetailItem('Denied reason', project.denied_reason, { full: true }) : ''}
      ${project.cancellation_reason ? adminDetailItem('Cancellation reason', project.cancellation_reason, { full: true }) : ''}
    </div>
    <div class="admin-detail-actions">
      <a class="btn-outline btn-xs" href="${safeHtml(publicUrl)}" target="_blank" rel="noopener">Open public page</a>
      ${FINANCIAL_SUPPORT_ENABLED && project.needs_financial_support ? `<button class="btn-outline btn-xs" type="button" onclick="approveProject('${safeHtml(project.id)}')">Approve financial support</button>` : ''}
      ${FINANCIAL_SUPPORT_ENABLED && project.needs_financial_support ? `<button class="btn-outline btn-xs btn-danger" type="button" onclick="denyProject('${safeHtml(project.id)}')">Deny financial support</button>` : ''}
      <button class="btn-outline btn-xs" type="button" onclick="markReviewed('${safeHtml(project.id)}')">Mark reviewed</button>
      ${project.status === 'cancelled'
        ? `<button class="btn-outline btn-xs" type="button" onclick="reactivateProject('${safeHtml(project.id)}')">Reactivate</button>`
        : `<button class="btn-outline btn-xs btn-warn" type="button" onclick="cancelProject('${safeHtml(project.id)}')">Cancel request</button>`}
    </div>
  `;
}

function openAdminProjectDetails(id) {
  const modal = $('#adminProjectModal');
  const body = $('#adminProjectModalBody');
  const title = $('#adminProjectModalTitle');
  const project = getAdminProjectById(id);
  if (!modal || !body) return;

  if (title) title.textContent = project?.title || 'Request information';
  body.innerHTML = renderAdminProjectDetails(project);
  modal.classList.remove('hide');
  document.body.classList.add('modal-open');
}

function closeAdminProjectDetails() {
  const modal = $('#adminProjectModal');
  if (!modal) return;
  modal.classList.add('hide');
  document.body.classList.remove('modal-open');
}

function renderAdminProjects(items) {
  const table = $('#adminProjectsTable');
  if (!table) return;

  const filtered = (items || []).filter(matchesAdminFilters);
  const countEl = $('#adminProjectsCount');
  if (countEl) countEl.textContent = `${filtered.length} request${filtered.length === 1 ? '' : 's'}`;

  if (!filtered.length) {
    table.innerHTML = '<tr><td colspan="6">No requests found with these filters.</td></tr>';
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
      <td class="admin-request-organization-cell">${safeHtml(item.organization_name || '-')}</td>
      <td>${getAdminProjectStatusBadge(item)}</td>

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
            <button class="btn-outline btn-xs" type="button" onclick="openAdminProjectDetails('${safeHtml(item.id)}')">View</button>
            ${FINANCIAL_SUPPORT_ENABLED && item.needs_financial_support ? `<button class="btn-outline btn-xs" onclick="approveProject('${item.id}')">Approve</button>` : ''}
            ${FINANCIAL_SUPPORT_ENABLED && item.needs_financial_support ? `<button class="btn-outline btn-xs btn-danger" onclick="denyProject('${item.id}')">Deny</button>` : ''}
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

    if (!FINANCIAL_SUPPORT_ENABLED) return;
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
    closeAdminProjectDetails();
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

  $('#adminProjectModalClose')?.addEventListener('click', closeAdminProjectDetails);
  $('#adminProjectModal')?.addEventListener('click', (event) => {
    if (event.target?.id === 'adminProjectModal') closeAdminProjectDetails();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAdminProjectDetails();
  });
}


function getFeedbackStatusBadge(item) {
  return String(item?.status || 'New') === 'Reviewed'
    ? '<span class="badge good">Reviewed</span>'
    : '<span class="badge warn">New</span>';
}

function feedbackPreview(message) {
  const value = String(message || '').trim();
  return value.length > 120 ? `${value.slice(0, 117).trim()}...` : value;
}

function renderAdminFeedback(items) {
  const table = $('#adminFeedbackTable');
  if (!table) return;

  const list = [...(items || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  if (!list.length) {
    table.innerHTML = '<tr><td colspan="8">No feedback found.</td></tr>';
    return;
  }

  table.innerHTML = list.map((item) => `
    <tr>
      <td>${formatIsoDateTime(item.created_at)}</td>
      <td>${safeHtml(item.name || '-')}</td>
      <td>${safeHtml(item.email || '-')}</td>
      <td>${safeHtml(item.type || 'Other')}</td>
      <td>${safeHtml(feedbackPreview(item.message))}</td>
      <td>${item.request_id ? `<a href="project.html?id=${encodeURIComponent(item.request_id)}">${safeHtml(item.request_id)}</a>` : '-'}</td>
      <td>${getFeedbackStatusBadge(item)}</td>
      <td>
        <div class="admin-actions-row wrap">
          <button class="btn-outline btn-xs" onclick="viewFeedbackDetails('${safeHtml(item.id)}')">View</button>
          <button class="btn-outline btn-xs" onclick="markFeedbackReviewed('${safeHtml(item.id)}')" ${String(item.status || 'New') === 'Reviewed' ? 'disabled' : ''}>Mark as Reviewed</button>
          <button class="btn-outline btn-xs btn-danger" onclick="deleteFeedbackItem('${safeHtml(item.id)}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function loadAdminFeedback() {
  const table = $('#adminFeedbackTable');
  if (!table) return;

  try {
    const { items } = await api('/admin/feedback');
    adminFeedbackCache = Array.isArray(items) ? items : [];
    renderAdminFeedback(adminFeedbackCache);
  } catch (error) {
    table.innerHTML = `<tr><td colspan="8">${safeHtml(error.message)}. Login as admin first.</td></tr>`;
  }
}

function viewFeedbackDetails(id) {
  const item = adminFeedbackCache.find((feedback) => feedback.id === id);
  if (!item) return alert('Feedback not found.');
  alert([
    `Date Submitted: ${formatIsoDateTime(item.created_at)}`,
    `Name: ${item.name || '-'}`,
    `Email: ${item.email || '-'}`,
    `Type: ${item.type || 'Other'}`,
    `Request ID: ${item.request_id || '-'}`,
    `Status: ${item.status || 'New'}`,
    '',
    item.message || ''
  ].join('\n'));
}

async function markFeedbackReviewed(id) {
  try {
    await api(`/admin/feedback/${id}/review`, { method: 'POST', body: JSON.stringify({}) });
    alert('Feedback marked as reviewed.');
    await loadAdminFeedback();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteFeedbackItem(id) {
  const ok = window.confirm('Are you sure you want to delete this feedback?');
  if (!ok) return;

  try {
    await api(`/admin/feedback/${id}`, { method: 'DELETE' });
    alert('Feedback deleted.');
    await loadAdminFeedback();
  } catch (error) {
    alert(error.message);
  }
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
            <span class="admin-user-meta">${safeHtml(user.email || '-')}</span>
            <span class="admin-user-meta">ID: ${safeHtml(user.id)}</span>
          </div>
        </td>
        <td>${getAdminUserRoleBadge(user)}</td>
        <td>${getAdminUserStatusBadge(user)}</td>
        <td>${safeHtml(user.country || '-')}</td>
        <td class="admin-organization-cell">${safeHtml(user.organization_name || '-')}</td>
        <td>${Number(user.request_count || 0)}</td>
        <td>${formatIsoDateTime(user.created_at)}</td>
        <td>
          <div class="admin-actions">
            <div class="admin-user-meta" style="margin-bottom:8px;">
              ${user.last_login_at ? `Last login: ${safeHtml(formatIsoDateTime(user.last_login_at))}` : 'Last login: -'}
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
  initProjectShareButtons();
  initMobileMenu();
  initFooterYear();
  initFilterPanels();
  initHeroVerseCarousel();
  handleAuthForms();
  handleSubmitProject();
  handlePlatformDonation();
  await refreshCurrentUser();
  toggleFinancialFields();
  loadProjects();
  loadProjectDetails();
  handleProfilePage();
  handleUnsubscribePage();
  handleFeedbackForm();
  handleVolunteerForm();
  initAdminFilters();
  initAdminUserFilters();
  loadAdmin();
  loadAdminUsers();
  loadAdminFeedback();
});

window.approveProject = approveProject;
window.denyProject = denyProject;
window.cancelProject = cancelProject;
window.reactivateProject = reactivateProject;
window.markReviewed = markReviewed;
window.toggleUserActive = toggleUserActive;
window.promoteUserToAdmin = promoteUserToAdmin;
window.deleteUserAccount = deleteUserAccount;
window.viewFeedbackDetails = viewFeedbackDetails;
window.markFeedbackReviewed = markFeedbackReviewed;
window.deleteFeedbackItem = deleteFeedbackItem;




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

async function handleUnsubscribePage() {
  const root = $('#unsubscribePage');
  if (!root) return;
  const params = new URLSearchParams(window.location.search);
  const unsubscribeToken = params.get('token') || '';
  if (!unsubscribeToken) {
    root.innerHTML = '<section class="card page-card"><h1>Unsubscribe</h1><p>This unsubscribe link is missing a token.</p><p><a class="btn" href="/profile.html">Open profile preferences</a></p></section>';
    return;
  }

  root.innerHTML = '<section class="card page-card"><h1>Unsubscribe</h1><p>Updating your email preference...</p></section>';
  try {
    await api('/email/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ token: unsubscribeToken })
    });
    root.innerHTML = '<section class="card page-card"><h1>You are unsubscribed</h1><p>You will no longer receive twice-weekly prayer request emails.</p><p>You can turn them back on anytime from your Profile preferences.</p><p><a class="btn" href="/profile.html">Open profile</a> <a class="btn-outline" href="/explore-projects.html">Explore Requests</a></p></section>';
  } catch (error) {
    root.innerHTML = `<section class="card page-card"><h1>Unsubscribe</h1><p>${safeHtml(error.message || 'Unable to update your preference.')}</p><p><a class="btn" href="/profile.html">Open profile preferences</a></p></section>`;
  }
}


 document.addEventListener('change', event => {
  if (event.target.name !== 'prayer_anonymous') return;
  const input = event.target.closest('form')?.querySelector('[name="name"]');
  if (input) {
    input.disabled = event.target.checked;
    input.hidden = event.target.checked;
  }
});
