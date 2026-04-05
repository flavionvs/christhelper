const API_BASE = localStorage.getItem('christhelper.api') || 'http://localhost:3000';
const token = localStorage.getItem('christhelper.token');
const currentUser = JSON.parse(localStorage.getItem('christhelper.user') || 'null');

function $(selector) {
  return document.querySelector(selector);
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(Number(value || 0));
}

function safeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
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
  if (nameEl && currentUser) nameEl.textContent = currentUser.name;
}

function logout() {
  localStorage.removeItem('christhelper.token');
  localStorage.removeItem('christhelper.user');
  window.location.href = 'index.html';
}

function projectCard(project) {
  const pct = project.funding_goal > 0 ? Math.min(100, Math.round((project.amount_raised / project.funding_goal) * 100)) : 0;
  const badges = [
    project.admin_reviewed ? '<span class="badge good">Admin reviewed</span>' : '',
    project.verified_ministry ? '<span class="badge good">Verified ministry</span>' : '',
    project.urgency === 'high' ? '<span class="badge alert">Urgent</span>' : '<span class="badge warn">' + safeHtml(project.urgency) + '</span>'
  ].join(' ');

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
        ${project.help_types.map(h => `<span class="badge">${safeHtml(h)}</span>`).join('')}
      </div>
      <div>${badges}</div>
      <p><strong>Requester:</strong> ${safeHtml(project.requester_name)}${project.organization_name ? ` · ${safeHtml(project.organization_name)}` : ''}</p>
      ${project.needs_financial_support && project.funding_approved ? `
        <div class="progress-wrap">
          <div style="display:flex;justify-content:space-between;gap:12px;">
            <strong>${formatMoney(project.amount_raised)}</strong>
            <span class="muted">Goal ${formatMoney(project.funding_goal)}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      ` : '<div class="notice">Financial support is not enabled for this project yet or this project is seeking non-financial help.</div>'}
      <div class="project-actions">
        <a class="btn" href="project.html?id=${project.id}">View details</a>
        <a class="btn-outline" href="project.html?id=${project.id}#pray">Pray</a>
        <a class="btn-outline" href="project.html?id=${project.id}#reply">Reply</a>
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
    $('#projectCount') && ($('#projectCount').textContent = `${items.length} active projects`);
    grid.innerHTML = items.length ? items.map(projectCard).join('') : '<div class="card panel"><p>No projects found with these filters.</p></div>';
  } catch (error) {
    grid.innerHTML = `<div class="card panel"><p>${safeHtml(error.message)}</p></div>`;
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
    const pct = project.funding_goal > 0 ? Math.min(100, Math.round((project.amount_raised / project.funding_goal) * 100)) : 0;

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
              ${project.help_types.map(h => `<span class="badge">${safeHtml(h)}</span>`).join('')}
              ${project.admin_reviewed ? '<span class="badge good">Admin reviewed</span>' : ''}
              ${project.verified_ministry ? '<span class="badge good">Verified church/ministry</span>' : ''}
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
              ${prayers.length ? prayers.map(item => `<div class="item"><strong>${safeHtml(item.name || 'Anonymous')}</strong>${safeHtml(item.message || '')}</div>`).join('') : '<p class="muted">No prayer messages yet.</p>'}
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
              ${replies.length ? replies.map(item => `<div class="item"><strong>${safeHtml(item.type)} · ${safeHtml(item.name)}</strong>${safeHtml(item.message)}</div>`).join('') : '<p class="muted">No replies yet.</p>'}
            </div>
          </section>

          <section class="card panel">
            <h2>Project updates</h2>
            <div class="list">
              ${updates.length ? updates.map(item => `<div class="item"><strong>${safeHtml(item.title)}</strong>${safeHtml(item.content)}<div class="muted" style="margin-top:8px;">${new Date(item.created_at).toLocaleString()}</div></div>`).join('') : '<p class="muted">No updates yet.</p>'}
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
                  <span class="muted">Goal ${formatMoney(project.funding_goal)}</span>
                </div>
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
              </div>
              <form id="projectDonationForm" class="simple-form" style="margin-top:16px;">
                <input name="donor_name" placeholder="Your name">
                <input name="donor_email" type="email" placeholder="Your email">
                <input name="amount_project" type="number" min="1" step="0.01" placeholder="Amount for this project" required>
                <input name="amount_platform" type="number" min="0" step="0.01" placeholder="Optional support for ChristHelper">
                <button class="btn" type="submit">Continue to secure payment</button>
              </form>
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
        localStorage.setItem('christhelper.token', data.token);
        localStorage.setItem('christhelper.user', JSON.stringify(data.user));
        window.location.href = 'index.html';
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
        localStorage.setItem('christhelper.token', data.token);
        localStorage.setItem('christhelper.user', JSON.stringify(data.user));
        window.location.href = 'index.html';
      } catch (error) {
        alert(error.message);
      }
    });
  }
}

function handleSubmitProject() {
  const form = $('#submitProjectForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd);
    payload.is_online = fd.get('is_online') === 'on';
    payload.needs_financial_support = fd.get('needs_financial_support') === 'on';
    payload.help_types = fd.getAll('help_types');

    try {
      await api('/projects', { method: 'POST', body: JSON.stringify(payload) });
      alert('Project submitted successfully.');
      form.reset();
      window.location.href = 'index.html';
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

async function loadAdmin() {
  const table = $('#adminProjectsTable');
  if (!table) return;
  try {
    const { items } = await api('/admin/projects');
    table.innerHTML = items.map(item => `
      <tr>
        <td>${item.id}</td>
        <td>${safeHtml(item.title)}</td>
        <td>${safeHtml(item.requester_name)}</td>
        <td>${item.needs_financial_support ? 'Yes' : 'No'}</td>
        <td>${item.funding_approved ? 'Approved' : 'Pending'}</td>
        <td>${item.admin_reviewed ? 'Reviewed' : 'No'}</td>
        <td>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn-outline" onclick="updateProjectStatus(${item.id}, true)">Approve financial</button>
            <button class="btn-outline" onclick="markReviewed(${item.id})">Mark reviewed</button>
          </div>
        </td>
      </tr>
    `).join('');

    const donations = await api('/admin/donations');
    $('#adminDonationTable').innerHTML = donations.items.map(item => `
      <tr>
        <td>${item.id}</td>
        <td>${safeHtml(item.donation_type)}</td>
        <td>${safeHtml(item.donor_name || 'Anonymous')}</td>
        <td>${formatMoney((item.amount_project || 0) + (item.amount_platform || 0))}</td>
        <td>${safeHtml(item.payment_status)}</td>
        <td>${new Date(item.created_at).toLocaleString()}</td>
      </tr>
    `).join('');
  } catch (error) {
    table.innerHTML = `<tr><td colspan="7">${safeHtml(error.message)}. Login as admin first.</td></tr>`;
  }
}

async function updateProjectStatus(id, fundingApproved) {
  try {
    await api(`/admin/projects/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ funding_approved: fundingApproved, admin_reviewed: true })
    });
    alert('Project updated.');
    loadAdmin();
  } catch (error) {
    alert(error.message);
  }
}

async function markReviewed(id) {
  try {
    await api(`/admin/projects/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ admin_reviewed: true })
    });
    alert('Project marked as reviewed.');
    loadAdmin();
  } catch (error) {
    alert(error.message);
  }
}

function initButtons() {
  document.querySelectorAll('[data-logout]').forEach(el => el.addEventListener('click', logout));
  document.querySelectorAll('[data-load-projects]').forEach(el => el.addEventListener('click', loadProjects));
}

document.addEventListener('DOMContentLoaded', () => {
  setAuthUi();
  initButtons();
  handleAuthForms();
  handleSubmitProject();
  handlePlatformDonation();
  loadProjects();
  loadProjectDetails();
  loadAdmin();
});
