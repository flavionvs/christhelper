require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://127.0.0.1:5500').replace(/\/+$/, '');
const CURRENCY = (process.env.STRIPE_CURRENCY || 'nzd').toLowerCase();
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'christhelper.db'));
const LEGACY_DATA_FILE = path.resolve(__dirname, process.env.DATA_FILE || './data.json');
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const EMAIL_FROM = String(process.env.EMAIL_FROM || 'ChristHelper <noreply@example.com>').trim();
const ADMIN_NOTIFICATION_EMAIL = String(process.env.ADMIN_NOTIFICATION_EMAIL || '').trim();
const SENDGRID_API_KEY = String(process.env.SENDGRID_API_KEY || '').trim();

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const sqlite = new DatabaseSync(DB_PATH);
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const allowedOrigins = Array.from(new Set(
  (process.env.CORS_ORIGINS || `${FRONTEND_URL},https://www.christhelper.com,https://christhelper.com` || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
));

app.use((req, res, next) => {
  req.url = req.url.replace(/^\/\/+/, '/').replace(/\/\/{2,}/g, '/');
  next();
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} origin=${req.headers.origin || '-'} host=${req.headers.host || '-'}`);
  next();
});

app.use(cors({
  origin(origin, callback) {
    const normalizedOrigin = String(origin || '').replace(/\/+$/, '');
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(normalizedOrigin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${normalizedOrigin}`));
  }
}));

app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

function now() {
  return new Date().toISOString();
}

function createId() {
  return crypto.randomUUID();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createNumericCode(length = 6) {
  const size = Math.max(4, Number(length) || 6);
  return Array.from({ length: size }, () => Math.floor(Math.random() * 10)).join('');
}

function addMinutesIso(minutes) {
  return new Date(Date.now() + Number(minutes || 0) * 60 * 1000).toISOString();
}

function isExpired(isoValue) {
  if (!isoValue) return true;
  const date = new Date(isoValue);
  return Number.isNaN(date.getTime()) || date.getTime() < Date.now();
}

function parseEmailAddress(input) {
  const value = String(input || '').trim();
  if (!value) return null;

  const angleMatch = value.match(/^(.*)<([^>]+)>$/);
  if (angleMatch) {
    const name = angleMatch[1].trim().replace(/^"|"$/g, '');
    const email = angleMatch[2].trim();
    if (!email) return null;
    return name ? { email, name } : { email };
  }

  return { email: value };
}

async function sendEmailMessage({ to, subject, html, text }) {
  const recipient = parseEmailAddress(to);
  if (!recipient?.email) return { skipped: true, reason: 'missing_recipient' };

  if (!SENDGRID_API_KEY) {
    console.log('Email skipped: SendGrid API key not configured', { to: recipient.email, subject });
    return { skipped: true, reason: 'sendgrid_not_configured' };
  }

  const sender = parseEmailAddress(EMAIL_FROM);
  if (!sender?.email) {
    console.error('Email skipped: EMAIL_FROM is invalid');
    return { ok: false, error: 'EMAIL_FROM is invalid' };
  }

  const safeSubject = String(subject || '').trim();
  const safeText = String(text || '').trim();
  const safeHtml = String(html || '').trim() || `<p>${safeText.replace(/</g, '&lt;')}</p>`;

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [recipient] }],
        from: sender,
        subject: safeSubject,
        content: [
          { type: 'text/plain', value: safeText || safeSubject || 'ChristHelper notification' },
          { type: 'text/html', value: safeHtml }
        ]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Email send failed:', response.status, errorBody);
      return { ok: false, error: `SendGrid API error ${response.status}` };
    }

    return { ok: true, id: response.headers.get('x-message-id') || '' };
  } catch (error) {
    console.error('Email send failed:', error.message);
    return { ok: false, error: error.message || 'Email send failed' };
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatProjectLink(projectId) {
  return `${FRONTEND_URL}/project.html?id=${encodeURIComponent(String(projectId || ''))}`;
}

function emailTemplate({ title, intro, details = [], ctaLabel = '', ctaUrl = '', footer = 'Thank you for using ChristHelper.' }) {
  const listHtml = details.length
    ? `<ul>${details.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '';
  const ctaHtml = ctaUrl && ctaLabel
    ? `<p><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 18px;background:#2a7b5f;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(ctaLabel)}</a></p>`
    : '';
  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1f2937;">
      <div style="font-size:22px;font-weight:700;margin-bottom:12px;">${escapeHtml(title)}</div>
      <p style="line-height:1.6;">${escapeHtml(intro)}</p>
      ${listHtml}
      ${ctaHtml}
      <p style="line-height:1.6;color:#6b7280;margin-top:20px;">${escapeHtml(footer)}</p>
    </div>
  `;
}

function textTemplate(intro, details = [], footer = 'Thank you for using ChristHelper.') {
  return [intro, details.length ? '' : null, ...details, '', footer].filter((v) => v !== null).join('\n');
}

async function sendProjectCreatorEmail(project, subject, intro, details = []) {
  const db = readDb();
  const owner = db.users.find((item) => item.id === project?.created_by);
  const to = owner?.email || project?.contact_email || '';
  return sendEmailMessage({
    to,
    subject,
    html: emailTemplate({ title: subject, intro, details, ctaLabel: project?.id ? 'View request' : '', ctaUrl: project?.id ? formatProjectLink(project.id) : '' }),
    text: textTemplate(intro, [...details, project?.id ? `View request: ${formatProjectLink(project.id)}` : ''].filter(Boolean))
  });
}

async function sendAdminDonationNotification(donation, project = null) {
  if (!ADMIN_NOTIFICATION_EMAIL) return { skipped: true, reason: 'admin_notification_email_missing' };
  const subject = project ? 'New donation received on ChristHelper project' : 'New ChristHelper donation received';
  const details = [
    `Type: ${project ? 'Request donation' : 'Platform support'}`,
    `Donor: ${donation?.donor_name || 'Anonymous'}`,
    donation?.donor_email ? `Donor email: ${donation.donor_email}` : '',
    `Request amount: ${Number(donation?.amount_project || 0).toFixed(2)} ${String(donation?.currency || CURRENCY).toUpperCase()}`,
    `Platform amount: ${Number(donation?.amount_platform || 0).toFixed(2)} ${String(donation?.currency || CURRENCY).toUpperCase()}`,
    project?.title ? `Project: ${project.title}` : '',
    donation?.donor_message ? `Message: ${donation.donor_message}` : ''
  ].filter(Boolean);
  return sendEmailMessage({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject,
    html: emailTemplate({ title: subject, intro: 'A new donation has been recorded in ChristHelper.', details }),
    text: textTemplate('A new donation has been recorded in ChristHelper.', details)
  });
}

function extractBearerUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

async function handleProjectResponseNotifications({ kind, project, item, actorUser }) {
  if (!project || !item) return;
  if (kind === 'prayer') {
    await sendProjectCreatorEmail(
      project,
      'New prayer received for your request',
      'Someone has just sent a prayer for your request on ChristHelper.',
      [
        `Project: ${project.title || ''}`,
        `From: ${item.name || 'Anonymous'}`,
        item.message ? `Prayer: ${item.message}` : ''
      ].filter(Boolean)
    );

    if (actorUser?.email) {
      await sendEmailMessage({
        to: actorUser.email,
        subject: 'Thank you for submitting a prayer',
        html: emailTemplate({
          title: 'Thank you for praying',
          intro: 'Your prayer was shared successfully on ChristHelper.',
          details: [project.title ? `Project: ${project.title}` : ''].filter(Boolean),
          ctaLabel: 'View request',
          ctaUrl: formatProjectLink(project.id)
        }),
        text: textTemplate('Your prayer was shared successfully on ChristHelper.', [project.title ? `Project: ${project.title}` : '', `View request: ${formatProjectLink(project.id)}`].filter(Boolean))
      });
    }
    return;
  }

  await sendProjectCreatorEmail(
    project,
    'New reply received for your request',
    'Someone has submitted a new reply for your request on ChristHelper.',
    [
      `Project: ${project.title || ''}`,
      `From: ${item.name || 'Anonymous'}`,
      item.type ? `Reply type: ${item.type}` : '',
      item.message ? `Reply: ${item.message}` : ''
    ].filter(Boolean)
  );

  if (item.email || actorUser?.email) {
    const helperEmail = item.email || actorUser?.email;
    await sendEmailMessage({
      to: helperEmail,
      subject: 'Thank you for your reply',
      html: emailTemplate({
        title: 'Thank you for responding',
        intro: 'Your reply was shared successfully on ChristHelper.',
        details: [project.title ? `Project: ${project.title}` : '', item.type ? `Reply type: ${item.type}` : ''].filter(Boolean),
        ctaLabel: 'View request',
        ctaUrl: formatProjectLink(project.id)
      }),
      text: textTemplate('Your reply was shared successfully on ChristHelper.', [project.title ? `Project: ${project.title}` : '', `View request: ${formatProjectLink(project.id)}`].filter(Boolean))
    });
  }
}

async function handleDonationNotifications(donation) {
  if (!donation || donation.payment_status !== 'paid') return;
  const db = readDb();
  const project = donation.project_id ? db.projects.find((item) => item.id === donation.project_id) : null;

  if (project) {
    await sendProjectCreatorEmail(
      project,
      'New donation received for your request',
      'A new donation has been completed for your request on ChristHelper.',
      [
        `Project: ${project.title || ''}`,
        `Donor: ${donation.donor_name || 'Anonymous'}`,
        donation.donor_email ? `Donor email: ${donation.donor_email}` : '',
        `Request amount: ${Number(donation.amount_project || 0).toFixed(2)} ${String(donation.currency || CURRENCY).toUpperCase()}`,
        Number(donation.amount_platform || 0) > 0 ? `Support for ChristHelper: ${Number(donation.amount_platform || 0).toFixed(2)} ${String(donation.currency || CURRENCY).toUpperCase()}` : '',
        donation.donor_message ? `Message: ${donation.donor_message}` : ''
      ].filter(Boolean)
    );
  }

  if (donation.donor_email) {
    await sendEmailMessage({
      to: donation.donor_email,
      subject: 'Thank you for your donation',
      html: emailTemplate({
        title: 'Thank you for your donation',
        intro: project
          ? 'Your donation was completed successfully and recorded on ChristHelper.'
          : 'Your support for ChristHelper was completed successfully.',
        details: [
          project?.title ? `Project: ${project.title}` : '',
          `Request amount: ${Number(donation.amount_project || 0).toFixed(2)} ${String(donation.currency || CURRENCY).toUpperCase()}`,
          `Platform amount: ${Number(donation.amount_platform || 0).toFixed(2)} ${String(donation.currency || CURRENCY).toUpperCase()}`
        ].filter(Boolean),
        ctaLabel: project ? 'View request' : '',
        ctaUrl: project ? formatProjectLink(project.id) : ''
      }),
      text: textTemplate(
        project ? 'Your donation was completed successfully and recorded on ChristHelper.' : 'Your support for ChristHelper was completed successfully.',
        [
          project?.title ? `Project: ${project.title}` : '',
          `Request amount: ${Number(donation.amount_project || 0).toFixed(2)} ${String(donation.currency || CURRENCY).toUpperCase()}`,
          `Platform amount: ${Number(donation.amount_platform || 0).toFixed(2)} ${String(donation.currency || CURRENCY).toUpperCase()}`,
          project ? `View request: ${formatProjectLink(project.id)}` : ''
        ].filter(Boolean)
      )
    });
  }

  await sendAdminDonationNotification(donation, project);
}

function sumStripeBalanceAmounts(entries = [], currency = CURRENCY) {
  const target = String(currency || '').toLowerCase();
  return entries
    .filter((item) => String(item.currency || '').toLowerCase() === target)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function mapStripeBalanceTransaction(item) {
  return {
    id: item.id,
    type: item.type || item.reporting_category || 'transaction',
    amount: Number(item.amount || 0) / 100,
    fee: Number(item.fee || 0) / 100,
    net: Number(item.net || 0) / 100,
    currency: String(item.currency || CURRENCY).toUpperCase(),
    description: item.description || '',
    created: item.created ? new Date(item.created * 1000).toISOString() : null,
    available_on: item.available_on ? new Date(item.available_on * 1000).toISOString() : null,
    source: typeof item.source === 'string'
      ? item.source
      : (item.source && typeof item.source === 'object' ? item.source.id || '' : ''),
    status: item.status || ''
  };
}


const COUNTRY_TO_CONTINENT = {
  'Afghanistan': 'Asia',
  'Albania': 'Europe',
  'Algeria': 'Africa',
  'Argentina': 'South America',
  'Australia': 'Oceania',
  'Austria': 'Europe',
  'Bangladesh': 'Asia',
  'Belgium': 'Europe',
  'Bolivia': 'South America',
  'Botswana': 'Africa',
  'Brazil': 'South America',
  'Bulgaria': 'Europe',
  'Cambodia': 'Asia',
  'Cameroon': 'Africa',
  'Canada': 'North America',
  'Chile': 'South America',
  'China': 'Asia',
  'Colombia': 'South America',
  'Costa Rica': 'North America',
  'Croatia': 'Europe',
  'Czech Republic': 'Europe',
  'Denmark': 'Europe',
  'Dominican Republic': 'North America',
  'Ecuador': 'South America',
  'Egypt': 'Africa',
  'El Salvador': 'North America',
  'Estonia': 'Europe',
  'Ethiopia': 'Africa',
  'Finland': 'Europe',
  'France': 'Europe',
  'Germany': 'Europe',
  'Ghana': 'Africa',
  'Greece': 'Europe',
  'Guatemala': 'North America',
  'Haiti': 'North America',
  'Honduras': 'North America',
  'Hungary': 'Europe',
  'India': 'Asia',
  'Indonesia': 'Asia',
  'Ireland': 'Europe',
  'Israel': 'Asia',
  'Italy': 'Europe',
  'Jamaica': 'North America',
  'Japan': 'Asia',
  'Kenya': 'Africa',
  'Malaysia': 'Asia',
  'Mexico': 'North America',
  'Morocco': 'Africa',
  'Mozambique': 'Africa',
  'Myanmar': 'Asia',
  'Namibia': 'Africa',
  'Nepal': 'Asia',
  'Netherlands': 'Europe',
  'New Zealand': 'Oceania',
  'Nicaragua': 'North America',
  'Nigeria': 'Africa',
  'Norway': 'Europe',
  'Pakistan': 'Asia',
  'Panama': 'North America',
  'Paraguay': 'South America',
  'Peru': 'South America',
  'Philippines': 'Asia',
  'Poland': 'Europe',
  'Portugal': 'Europe',
  'Romania': 'Europe',
  'Russia': 'Europe',
  'Rwanda': 'Africa',
  'Saudi Arabia': 'Asia',
  'Singapore': 'Asia',
  'South Africa': 'Africa',
  'South Korea': 'Asia',
  'Spain': 'Europe',
  'Sri Lanka': 'Asia',
  'Sweden': 'Europe',
  'Switzerland': 'Europe',
  'Tanzania': 'Africa',
  'Thailand': 'Asia',
  'Uganda': 'Africa',
  'Ukraine': 'Europe',
  'United Kingdom': 'Europe',
  'UK': 'Europe',
  'United States': 'North America',
  'USA': 'North America',
  'Uruguay': 'South America',
  'Venezuela': 'South America',
  'Vietnam': 'Asia',
  'Zambia': 'Africa',
  'Zimbabwe': 'Africa'
};

function detectContinentFromCountry(country) {
  const normalized = String(country || '').trim();
  return COUNTRY_TO_CONTINENT[normalized] || '';
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object') return user;

  if (!Object.prototype.hasOwnProperty.call(user, 'stripe_account_id')) user.stripe_account_id = '';
  if (!Object.prototype.hasOwnProperty.call(user, 'stripe_onboarding_complete')) user.stripe_onboarding_complete = false;
  if (!Object.prototype.hasOwnProperty.call(user, 'stripe_charges_enabled')) user.stripe_charges_enabled = false;
  if (!Object.prototype.hasOwnProperty.call(user, 'stripe_payouts_enabled')) user.stripe_payouts_enabled = false;
  if (!Object.prototype.hasOwnProperty.call(user, 'stripe_details_submitted')) user.stripe_details_submitted = false;

  if (!Object.prototype.hasOwnProperty.call(user, 'country')) user.country = '';
  if (!Object.prototype.hasOwnProperty.call(user, 'organization_name')) user.organization_name = '';
  if (!Object.prototype.hasOwnProperty.call(user, 'show_email_publicly')) user.show_email_publicly = false;
  if (!Object.prototype.hasOwnProperty.call(user, 'allow_financial_support')) user.allow_financial_support = true;
  if (!Object.prototype.hasOwnProperty.call(user, 'allow_prayer_requests')) user.allow_prayer_requests = true;
  if (!Object.prototype.hasOwnProperty.call(user, 'allow_replies')) user.allow_replies = true;
  if (!Object.prototype.hasOwnProperty.call(user, 'hide_archived_projects')) user.hide_archived_projects = false;
  if (!Object.prototype.hasOwnProperty.call(user, 'exclude_closed_projects')) user.exclude_closed_projects = false;
  if (!Object.prototype.hasOwnProperty.call(user, 'is_active')) user.is_active = true;
  if (!Object.prototype.hasOwnProperty.call(user, 'deactivated_at')) user.deactivated_at = null;
  if (!Object.prototype.hasOwnProperty.call(user, 'email_verified')) user.email_verified = true;
  if (!Object.prototype.hasOwnProperty.call(user, 'email_verification_code')) user.email_verification_code = '';
  if (!Object.prototype.hasOwnProperty.call(user, 'email_verification_expires_at')) user.email_verification_expires_at = null;
  if (!Object.prototype.hasOwnProperty.call(user, 'email_verified_at')) user.email_verified_at = null;
  if (!Object.prototype.hasOwnProperty.call(user, 'reset_password_code')) user.reset_password_code = '';
  if (!Object.prototype.hasOwnProperty.call(user, 'reset_password_expires_at')) user.reset_password_expires_at = null;
  if (!Object.prototype.hasOwnProperty.call(user, 'terms_accepted')) user.terms_accepted = true;
  if (!Object.prototype.hasOwnProperty.call(user, 'terms_accepted_at')) user.terms_accepted_at = null;

  return user;
}

function normalizeProject(project) {
  if (!project || typeof project !== 'object') return project;

  if (!Object.prototype.hasOwnProperty.call(project, 'owner_can_receive_payments')) project.owner_can_receive_payments = false;
  if (!Object.prototype.hasOwnProperty.call(project, 'archived')) project.archived = false;
  if (!Object.prototype.hasOwnProperty.call(project, 'excluded')) project.excluded = false;

  if (!Object.prototype.hasOwnProperty.call(project, 'funding_goal_currency')) {
    project.funding_goal_currency = project.needs_financial_support ? 'USD' : '';
  }

  if (!Object.prototype.hasOwnProperty.call(project, 'campaign_expiry_date')) {
    project.campaign_expiry_date = '';
  }

  if (!Object.prototype.hasOwnProperty.call(project, 'is_anonymous')) {
    project.is_anonymous = false;
  }

  if (!Object.prototype.hasOwnProperty.call(project, 'responses_public')) {
    project.responses_public = true;
  }

  if (!Object.prototype.hasOwnProperty.call(project, 'project_links')) {
    project.project_links = [];
  }

  if (!Array.isArray(project.project_links)) {
    project.project_links = [];
  }

  if (!Object.prototype.hasOwnProperty.call(project, 'last_donation_at')) {
    project.last_donation_at = null;
  }

  if (!Object.prototype.hasOwnProperty.call(project, 'financial_denied')) {
    project.financial_denied = false;
  }

  if (!Object.prototype.hasOwnProperty.call(project, 'denied_reason')) {
    project.denied_reason = '';
  }

  if (!Object.prototype.hasOwnProperty.call(project, 'cancellation_reason')) {
    project.cancellation_reason = '';
  }

  if (!Object.prototype.hasOwnProperty.call(project, 'cancelled_at')) {
    project.cancelled_at = null;
  }

  if (!project.continent && project.country) {
    project.continent = detectContinentFromCountry(project.country) || '';
  }

  return project;
}


function isProjectPubliclyVisible(project) {
  if (!project || typeof project !== 'object') return false;

  const status = String(project.status || 'active').toLowerCase();
  const visibility = String(project.visibility || '').toLowerCase();
  const fullyViewable = project.fully_viewable !== false && project.is_fully_viewable !== false;

  if (project.excluded || project.is_excluded) return false;
  if (project.archived || project.is_archived) return false;
  if (!fullyViewable) return false;
  if (['draft', 'inactive', 'cancelled', 'restricted', 'hidden'].includes(status)) return false;
  if (visibility && ['private', 'restricted', 'hidden', 'draft'].includes(visibility)) return false;
  if (project.display_approved === false) return false;
  if (project.approved_for_display === false) return false;
  if (project.publicly_visible === false) return false;
  if (project.is_public === false) return false;
  if (project.needs_financial_support) {
    if (project.admin_reviewed === false) return false;
    if (!project.funding_approved) return false;
  }

  return true;
}

function normalizeDonation(donation) {
  if (!donation || typeof donation !== 'object') return donation;

  if (!Object.prototype.hasOwnProperty.call(donation, 'stripe_payment_intent_id')) donation.stripe_payment_intent_id = '';
  if (!Object.prototype.hasOwnProperty.call(donation, 'processed_at')) donation.processed_at = null;
  if (!Object.prototype.hasOwnProperty.call(donation, 'checkout_session_status')) donation.checkout_session_status = '';
  if (!Object.prototype.hasOwnProperty.call(donation, 'donor_message')) donation.donor_message = '';

  return donation;
}

function syncProjectFundingEligibility(db) {
  const userMap = new Map(db.users.map((user) => [user.id, user]));
  for (const project of db.projects) {
    const owner = userMap.get(project.created_by);
    project.owner_can_receive_payments = Boolean(owner?.stripe_charges_enabled && owner?.allow_financial_support !== false);
  }
}

function createSeedData() {
  const adminId = createId();
  const project1 = createId();
  const project2 = createId();
  const project3 = createId();

  const seeded = {
    meta: {
      version: 5,
      created_at: now()
    },
    users: [
      normalizeUser({
        id: adminId,
        name: 'ChristHelper Admin',
        email: 'admin@christhelper.local',
        password_hash: bcrypt.hashSync('admin123', 10),
        role: 'admin',
        created_at: now()
      })
    ],
    projects: [
      normalizeProject({
        id: project1,
        title: 'Youth Outreach Weekend in Auckland',
        summary: 'Local church seeking prayer, volunteers, and small funding support for a youth outreach weekend.',
        description: 'We are organizing a youth outreach weekend with worship, games, testimonies, and evangelism activities. We need volunteers, prayer covering, and support for transport and food.',
        country: 'New Zealand',
        continent: 'Oceania',
        city: 'Auckland',
        category: 'Youth ministry',
        help_types: ['Prayer', 'Volunteer', 'Financial support'],
        requester_name: 'Pastor Daniel',
        organization_name: 'Hope Community Church',
        church_ministry_linked: 'Hope Community Church',
        contact_email: 'pastor@example.com',
        urgency: 'high',
        is_online: false,
        needs_financial_support: true,
        funding_goal: 1200,
        funding_goal_currency: 'USD',
        campaign_expiry_date: '2026-06-30',
        project_links: ['https://example.com/youth-outreach'],
        funding_approved: true,
        amount_raised: 350,
        admin_reviewed: true,
        verified_ministry: true,
        status: 'active',
        timeline: 'May 2026',
        who_benefits: 'Teenagers and young adults in the community',
        why_it_matters: 'Many youth are disconnected from church and need hope, mentoring, and community.',
        created_by: adminId,
        created_at: now(),
        owner_can_receive_payments: false,
        archived: false,
        excluded: false
      }),
      normalizeProject({
        id: project2,
        title: 'Bible Distribution for Rural Families',
        summary: 'Mission project requesting prayer and financial support to distribute Bibles in remote communities.',
        description: 'A mission team is preparing a Bible distribution trip for remote communities with limited access to Christian resources. Support is needed for travel, printing, and prayer.',
        country: 'Brazil',
        continent: 'South America',
        city: 'Manaus',
        category: 'Bible distribution',
        help_types: ['Prayer', 'Financial support', 'Guidance'],
        requester_name: 'Missionary Ana',
        organization_name: 'Grace Missions',
        church_ministry_linked: 'Grace Missions',
        contact_email: 'ana@example.com',
        urgency: 'normal',
        is_online: false,
        needs_financial_support: true,
        funding_goal: 2500,
        funding_goal_currency: 'USD',
        campaign_expiry_date: '2026-07-15',
        project_links: ['https://example.com/bible-distribution', 'https://instagram.com/exampleministry'],
        funding_approved: true,
        amount_raised: 900,
        admin_reviewed: true,
        verified_ministry: false,
        status: 'active',
        timeline: 'June 2026',
        who_benefits: 'Families in remote river communities',
        why_it_matters: 'Access to Scripture is limited and many families have requested Bibles and study material.',
        created_by: adminId,
        created_at: now(),
        owner_can_receive_payments: false,
        archived: false,
        excluded: false
      }),
      normalizeProject({
        id: project3,
        title: 'Christian Media Website Launch',
        summary: 'A Christian media team needs mentorship, technical guidance, and prayer to launch a discipleship website.',
        description: 'We are building a Christian media website with articles, devotionals, and teaching resources. We need advice on launch strategy, content planning, and volunteers for editing.',
        country: 'United States',
        continent: 'North America',
        city: 'Online',
        category: 'Christian media',
        help_types: ['Prayer', 'Mentorship', 'Services'],
        requester_name: 'Sarah Lee',
        organization_name: 'Light Online',
        church_ministry_linked: '',
        contact_email: 'sarah@example.com',
        urgency: 'low',
        is_online: true,
        needs_financial_support: false,
        funding_goal: 0,
        funding_goal_currency: '',
        campaign_expiry_date: '',
        project_links: ['https://example.com/light-online'],
        funding_approved: false,
        amount_raised: 0,
        admin_reviewed: true,
        verified_ministry: false,
        status: 'active',
        timeline: 'Ongoing',
        who_benefits: 'Online readers and small groups',
        why_it_matters: 'Many people need accessible digital discipleship resources.',
        created_by: adminId,
        created_at: now(),
        owner_can_receive_payments: false,
        archived: false,
        excluded: false
      })
    ],
    prayers: [],
    replies: [],
    donations: [],
    updates: [
      { id: createId(), project_id: project1, title: 'Project created', content: 'Thank you for standing with this need. We will post updates as support comes in.', created_at: now() },
      { id: createId(), project_id: project2, title: 'Project created', content: 'Thank you for standing with this need. We will post updates as support comes in.', created_at: now() },
      { id: createId(), project_id: project3, title: 'Project created', content: 'Thank you for standing with this need. We will post updates as support comes in.', created_at: now() }
    ],
    reports: []
  };

  syncProjectFundingEligibility(seeded);
  return seeded;
}

function hasSQLiteState() {
  const row = sqlite.prepare('SELECT value FROM app_state WHERE key = ?').get('main');
  return Boolean(row && row.value);
}

function importLegacyJsonIfPresent() {
  if (!fs.existsSync(LEGACY_DATA_FILE)) return null;
  const raw = fs.readFileSync(LEGACY_DATA_FILE, 'utf8').trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function persistDb(db) {
  sqlite.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run('main', JSON.stringify(db), now());
}

function readDb() {
  if (!hasSQLiteState()) {
    const imported = importLegacyJsonIfPresent();
    const seeded = imported || createSeedData();
    persistDb(seeded);
    return seeded;
  }

  const row = sqlite.prepare('SELECT value FROM app_state WHERE key = ?').get('main');
  const raw = String(row?.value || '').trim();
  if (!raw) {
    const seeded = createSeedData();
    persistDb(seeded);
    return seeded;
  }

  const db = JSON.parse(raw);
  let changed = false;

  for (const key of ['users', 'projects', 'prayers', 'replies', 'donations', 'updates', 'reports']) {
    if (!Array.isArray(db[key])) {
      db[key] = [];
      changed = true;
    }
  }

  if (!db.meta || typeof db.meta !== 'object') {
    db.meta = { version: 5, created_at: now() };
    changed = true;
  } else if (!db.meta.version || db.meta.version < 5) {
    db.meta.version = 5;
    changed = true;
  }

  for (const user of db.users) {
    const before = JSON.stringify(user);
    normalizeUser(user);
    if (before !== JSON.stringify(user)) changed = true;
  }

  for (const project of db.projects) {
    const before = JSON.stringify(project);
    normalizeProject(project);
    if (before !== JSON.stringify(project)) changed = true;
  }

  for (const donation of db.donations) {
    const before = JSON.stringify(donation);
    normalizeDonation(donation);
    if (before !== JSON.stringify(donation)) changed = true;
  }

  if (!db.users.find((u) => u.email === 'admin@christhelper.local')) {
    db.users.push(normalizeUser({
      id: createId(),
      name: 'ChristHelper Admin',
      email: 'admin@christhelper.local',
      password_hash: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      created_at: now()
    }));
    changed = true;
  }

  syncProjectFundingEligibility(db);
  if (changed) writeDb(db);
  return db;
}

function writeDb(db) {
  syncProjectFundingEligibility(db);
  persistDb(db);
}

function withDb(action) {
  const db = readDb();
  const result = action(db);
  writeDb(db);
  return result;
}

function getAdminUserView(db, user) {
  if (!user) return null;
  const projectCount = db.projects.filter((item) => item.created_by === user.id).length;
  const activeProjectCount = db.projects.filter((item) => item.created_by === user.id && String(item.status || 'active') === 'active' && !item.archived && !item.excluded).length;
  const donationCount = db.donations.filter((item) => item.project_id && db.projects.some((project) => project.id === item.project_id && project.created_by === user.id)).length;

  return {
    ...publicUser(user),
    created_at: user.created_at || null,
    last_login_at: user.last_login_at || null,
    project_count: projectCount,
    active_project_count: activeProjectCount,
    donation_count: donationCount
  };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    stripe_account_id: user.stripe_account_id || '',
    stripe_onboarding_complete: Boolean(user.stripe_onboarding_complete),
    stripe_charges_enabled: Boolean(user.stripe_charges_enabled),
    stripe_payouts_enabled: Boolean(user.stripe_payouts_enabled),
    stripe_details_submitted: Boolean(user.stripe_details_submitted),
    country: user.country || '',
    organization_name: user.organization_name || '',
    show_email_publicly: Boolean(user.show_email_publicly),
    allow_financial_support: user.allow_financial_support !== false,
    allow_prayer_requests: user.allow_prayer_requests !== false,
    allow_replies: user.allow_replies !== false,
    hide_archived_projects: Boolean(user.hide_archived_projects),
    exclude_closed_projects: Boolean(user.exclude_closed_projects),
    is_active: user.is_active !== false,
    deactivated_at: user.deactivated_at || null,
    email_verified: Boolean(user.email_verified),
    email_verified_at: user.email_verified_at || null,
    terms_accepted: Boolean(user.terms_accepted),
    terms_accepted_at: user.terms_accepted_at || null
  };
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

async function refreshStripeAccountState(userId) {
  if (!stripe) return null;
  const db = readDb();
  const user = db.users.find((item) => item.id === userId);
  if (!user || !user.stripe_account_id) return null;

  const account = await stripe.accounts.retrieve(user.stripe_account_id);
  user.stripe_details_submitted = Boolean(account.details_submitted);
  user.stripe_charges_enabled = Boolean(account.charges_enabled);
  user.stripe_payouts_enabled = Boolean(account.payouts_enabled);
  user.stripe_onboarding_complete = Boolean(account.details_submitted && account.charges_enabled);

  writeDb(db);
  return { user: clone(publicUser(user)), account };
}

function getCountsForProject(db, projectId) {
  return {
    prayer_count: db.prayers.filter((item) => item.project_id === projectId).length,
    reply_count: db.replies.filter((item) => item.project_id === projectId).length
  };
}

function getOwnedProjectOr403(db, projectId, userId) {
  const project = db.projects.find((item) => item.id === projectId);
  if (!project) return { error: 'Request not found', status: 404 };
  if (project.created_by !== userId) return { error: 'You do not have permission to modify this request', status: 403 };
  return { project };
}

function normalizeResponseKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'prayer' || normalized === 'pray') return 'prayer';
  if (normalized === 'reply' || normalized === 'respond' || normalized === 'response') return 'reply';
  return '';
}

function createProjectResponse(db, projectId, payload = {}) {
  const project = db.projects.find((item) => item.id === projectId);
  if (!project) return { error: 'Request not found', status: 404 };

  const kind = normalizeResponseKind(payload.kind || payload.response_kind || payload.category || payload.mode || payload.action || payload.type);
  const name = String(payload.name || 'Anonymous').trim() || 'Anonymous';
  const email = String(payload.email || '').trim();
  const message = String(payload.message || '').trim();
  const replyType = String(payload.type || payload.reply_type || '').trim();

  if (!kind) {
    return { error: 'Response kind must be prayer or reply', status: 400 };
  }

  if (!message) {
    return { error: 'Message is required', status: 400 };
  }

  if (kind === 'prayer') {
    const prayer = {
      id: createId(),
      project_id: projectId,
      name,
      email,
      message,
      created_at: now()
    };
    db.prayers.push(prayer);
    return {
      kind,
      item: clone(prayer),
      message: 'Prayer support recorded. Thank you.'
    };
  }

  if (!replyType) {
    return { error: 'Reply type is required', status: 400 };
  }

  const reply = {
    id: createId(),
    project_id: projectId,
    type: replyType,
    name,
    email,
    message,
    created_at: now()
  };
  db.replies.push(reply);

  return {
    kind,
    item: clone(reply),
    message: 'Your response has been sent.'
  };
}

function applyPaidDonation(db, donation, sessionLike = null) {
  if (!donation) return { changed: false, reason: 'Donation not found' };

  normalizeDonation(donation);

  if (sessionLike?.id) donation.stripe_session_id = sessionLike.id;
  if (sessionLike?.payment_intent) donation.stripe_payment_intent_id = String(sessionLike.payment_intent);
  if (sessionLike?.payment_status) donation.checkout_session_status = String(sessionLike.payment_status);

  if (donation.payment_status === 'paid' && donation.processed_at) {
    return { changed: false, reason: 'Donation already processed', donation };
  }

  donation.payment_status = 'paid';
  donation.processed_at = now();

  let project = null;
  if (donation.project_id) {
    project = db.projects.find((item) => item.id === donation.project_id);
    if (project) {
      normalizeProject(project);
      project.amount_raised = Number(project.amount_raised || 0) + Number(donation.amount_project || 0);
      project.last_donation_at = donation.processed_at;
    }
  }

  return { changed: true, donation, project };
}

app.get(['/health','/api/health'], (req, res) => {
  res.json({
    ok: true,
    app: 'christhelper-backend-node24-safe',
    time: now(),
    db_path: DB_PATH,
    legacy_data_file: LEGACY_DATA_FILE,
    frontend_url: FRONTEND_URL,
    stripe_configured: Boolean(stripe),
    webhook_secret_configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    sendgrid_configured: Boolean(SENDGRID_API_KEY),
    admin_notification_email_configured: Boolean(ADMIN_NOTIFICATION_EMAIL)
  });
});

app.post('/auth/register', async (req, res) => {
  const { name, email, password, terms_accepted } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (!terms_accepted) {
    return res.status(400).json({ error: 'You must agree to the Terms & Conditions before creating an account' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const verificationCode = createNumericCode(6);

  const createdUser = withDb((db) => {
    if (db.users.find((user) => user.email === normalizedEmail)) {
      return null;
    }

    const user = normalizeUser({
      id: createId(),
      name: String(name).trim(),
      email: normalizedEmail,
      password_hash: bcrypt.hashSync(String(password), 10),
      role: 'supporter',
      email_verified: false,
      email_verification_code: verificationCode,
      email_verification_expires_at: addMinutesIso(30),
      terms_accepted: true,
      terms_accepted_at: now(),
      created_at: now()
    });

    db.users.push(user);
    return publicUser(user);
  });

  if (!createdUser) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  await sendEmailMessage({
    to: normalizedEmail,
    subject: 'Verify your ChristHelper email',
    html: emailTemplate({
      title: 'Verify your email',
      intro: 'Use the verification code below to activate your ChristHelper account.',
      details: [`Verification code: ${verificationCode}`, 'This code expires in 30 minutes.'],
      ctaLabel: 'Open verification page',
      ctaUrl: `${FRONTEND_URL}/verify-email.html?email=${encodeURIComponent(normalizedEmail)}`
    }),
    text: textTemplate('Use the verification code below to activate your ChristHelper account.', [
      `Verification code: ${verificationCode}`,
      'This code expires in 30 minutes.',
      `Open verification page: ${FRONTEND_URL}/verify-email.html?email=${encodeURIComponent(normalizedEmail)}`
    ])
  });

  res.json({
    requires_verification: true,
    email: normalizedEmail,
    message: 'Verification code sent. Please check your email inbox to continue.'
  });
});

app.post('/auth/resend-verification', async (req, res) => {
  const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
  if (!normalizedEmail) return res.status(400).json({ error: 'Email is required' });

  let payload = null;
  withDb((db) => {
    const user = db.users.find((item) => item.email === normalizedEmail);
    if (!user) return;
    if (user.email_verified) {
      payload = { already_verified: true };
      return;
    }
    user.email_verification_code = createNumericCode(6);
    user.email_verification_expires_at = addMinutesIso(30);
    payload = {
      code: user.email_verification_code,
      expires_at: user.email_verification_expires_at
    };
  });

  if (!payload) return res.json({ message: 'If the account exists, a verification code has been sent.' });
  if (payload.already_verified) return res.json({ message: 'This account is already verified.' });

  await sendEmailMessage({
    to: normalizedEmail,
    subject: 'Your ChristHelper verification code',
    html: emailTemplate({
      title: 'Verification code',
      intro: 'Use the code below to verify your ChristHelper account.',
      details: [`Verification code: ${payload.code}`, 'This code expires in 30 minutes.'],
      ctaLabel: 'Open verification page',
      ctaUrl: `${FRONTEND_URL}/verify-email.html?email=${encodeURIComponent(normalizedEmail)}`
    }),
    text: textTemplate('Use the code below to verify your ChristHelper account.', [
      `Verification code: ${payload.code}`,
      'This code expires in 30 minutes.',
      `Open verification page: ${FRONTEND_URL}/verify-email.html?email=${encodeURIComponent(normalizedEmail)}`
    ])
  });

  res.json({ message: 'Verification code sent.' });
});

app.post('/auth/verify-email', (req, res) => {
  const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  if (!normalizedEmail || !code) return res.status(400).json({ error: 'Email and verification code are required' });

  const verifiedUser = withDb((db) => {
    const user = db.users.find((item) => item.email === normalizedEmail);
    if (!user) return { error: 'Account not found', status: 404 };
    if (user.email_verified) return publicUser(user);
    if (!user.email_verification_code || user.email_verification_code !== code) {
      return { error: 'Invalid verification code', status: 400 };
    }
    if (isExpired(user.email_verification_expires_at)) {
      return { error: 'Verification code expired. Please request a new code.', status: 400 };
    }

    user.email_verified = true;
    user.email_verified_at = now();
    user.email_verification_code = '';
    user.email_verification_expires_at = null;
    return publicUser(user);
  });

  if (verifiedUser?.error) return res.status(verifiedUser.status || 400).json({ error: verifiedUser.error });

  const token = jwt.sign(verifiedUser, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: verifiedUser, message: 'Email verified successfully.' });
});

app.post('/auth/forgot-password', async (req, res) => {
  const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
  if (!normalizedEmail) return res.status(400).json({ error: 'Email is required' });

  let payload = null;
  withDb((db) => {
    const user = db.users.find((item) => item.email === normalizedEmail);
    if (!user) return;
    user.reset_password_code = createNumericCode(6);
    user.reset_password_expires_at = addMinutesIso(30);
    payload = {
      code: user.reset_password_code,
      name: user.name || '',
      verified: Boolean(user.email_verified)
    };
  });

  if (payload) {
    await sendEmailMessage({
      to: normalizedEmail,
      subject: 'Reset your ChristHelper password',
      html: emailTemplate({
        title: 'Password reset',
        intro: 'Use the code below to reset your ChristHelper password.',
        details: [`Reset code: ${payload.code}`, 'This code expires in 30 minutes.'],
        ctaLabel: 'Open reset page',
        ctaUrl: `${FRONTEND_URL}/reset-password.html?email=${encodeURIComponent(normalizedEmail)}`
      }),
      text: textTemplate('Use the code below to reset your ChristHelper password.', [
        `Reset code: ${payload.code}`,
        'This code expires in 30 minutes.',
        `Open reset page: ${FRONTEND_URL}/reset-password.html?email=${encodeURIComponent(normalizedEmail)}`
      ])
    });
  }

  res.json({ message: 'If the account exists, a password reset code has been sent.' });
});

app.post('/auth/reset-password', (req, res) => {
  const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  const newPassword = String(req.body?.password || '');
  if (!normalizedEmail || !code || !newPassword) return res.status(400).json({ error: 'Email, reset code and new password are required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must have at least 6 characters' });

  const result = withDb((db) => {
    const user = db.users.find((item) => item.email === normalizedEmail);
    if (!user) return { error: 'Account not found', status: 404 };
    if (!user.reset_password_code || user.reset_password_code !== code) {
      return { error: 'Invalid reset code', status: 400 };
    }
    if (isExpired(user.reset_password_expires_at)) {
      return { error: 'Reset code expired. Please request a new one.', status: 400 };
    }
    user.password_hash = bcrypt.hashSync(newPassword, 10);
    user.reset_password_code = '';
    user.reset_password_expires_at = null;
    return publicUser(user);
  });

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });

  const token = jwt.sign(result, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: result, message: 'Password updated successfully.' });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const db = readDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = db.users.find((item) => item.email === normalizedEmail);

  if (!user || user.is_active === false || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!user.email_verified) {
    return res.status(403).json({
      error: 'Please verify your email before signing in.',
      requires_verification: true,
      email: normalizedEmail
    });
  }

  user.last_login_at = now();
  writeDb(db);

  const payload = publicUser(user);
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: payload });
});

app.get('/auth/me', authRequired, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.is_active === false) return res.status(403).json({ error: 'Account is deactivated' });
  res.json({ user: publicUser(user) });
});

app.get('/profile', authRequired, async (req, res) => {
  if (stripe) {
    try {
      await refreshStripeAccountState(req.user.id);
    } catch (error) {
      console.error('Stripe status refresh failed', error.message);
    }
  }

  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.is_active === false) return res.status(403).json({ error: 'Account is deactivated' });

  const projects = db.projects
    .filter((project) => project.created_by === req.user.id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((project) => ({
      ...clone(project),
      ...getCountsForProject(db, project.id)
    }));

  res.json({ user: publicUser(user), projects });
});

app.post('/profile/update', authRequired, (req, res) => {
  const { name, email, country, organization_name } = req.body || {};

  const updated = withDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return { error: 'User not found', status: 404 };

    if (email) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const existing = db.users.find((item) => item.email === normalizedEmail && item.id !== req.user.id);
      if (existing) return { error: 'Email already in use', status: 409 };
      user.email = normalizedEmail;
    }

    if (name !== undefined) user.name = String(name).trim();
    if (country !== undefined) user.country = String(country).trim();
    if (organization_name !== undefined) user.organization_name = String(organization_name).trim();

    for (const project of db.projects) {
      if (project.created_by === req.user.id) {
        if (!project.is_anonymous && user.organization_name && !project.organization_name) {
          project.organization_name = user.organization_name;
        }
      }
    }

    return { user: publicUser(user) };
  });

  if (updated?.error) return res.status(updated.status || 400).json({ error: updated.error });
  res.json({ message: 'Profile updated', user: updated.user });
});

app.post('/profile/preferences', authRequired, (req, res) => {
  const {
    show_email_publicly,
    allow_financial_support,
    allow_prayer_requests,
    allow_replies,
    hide_archived_projects,
    exclude_closed_projects
  } = req.body || {};

  const updated = withDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;

    if (show_email_publicly !== undefined) user.show_email_publicly = Boolean(show_email_publicly);
    if (allow_financial_support !== undefined) user.allow_financial_support = Boolean(allow_financial_support);
    if (allow_prayer_requests !== undefined) user.allow_prayer_requests = Boolean(allow_prayer_requests);
    if (allow_replies !== undefined) user.allow_replies = Boolean(allow_replies);
    if (hide_archived_projects !== undefined) user.hide_archived_projects = Boolean(hide_archived_projects);
    if (exclude_closed_projects !== undefined) user.exclude_closed_projects = Boolean(exclude_closed_projects);

    return publicUser(user);
  });

  if (!updated) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Preferences updated', user: updated });
});

app.get('/profile/export', authRequired, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const projects = db.projects.filter((item) => item.created_by === req.user.id);
  const projectIds = new Set(projects.map((p) => p.id));

  const payload = {
    exported_at: now(),
    user: publicUser(user),
    projects: clone(projects),
    prayers: clone(db.prayers.filter((item) => projectIds.has(item.project_id))),
    replies: clone(db.replies.filter((item) => projectIds.has(item.project_id))),
    donations: clone(db.donations.filter((item) => projectIds.has(item.project_id))),
    updates: clone(db.updates.filter((item) => projectIds.has(item.project_id))),
    reports: clone(db.reports.filter((item) => projectIds.has(item.project_id)))
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="christhelper-profile-export-${req.user.id}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

app.post('/profile/deactivate', authRequired, (req, res) => {
  const updated = withDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;

    user.is_active = false;
    user.deactivated_at = now();

    for (const project of db.projects) {
      if (project.created_by === req.user.id) {
        project.status = 'inactive';
        project.archived = true;
      }
    }

    return publicUser(user);
  });

  if (!updated) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Account deactivated', user: updated });
});

app.post('/stripe/connect/onboard', authRequired, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured yet on the backend' });
    }

    const { refresh_url, return_url } = req.body || {};
    const urls = {
      refresh_url: refresh_url || `${FRONTEND_URL}/profile.html?stripe=refresh`,
      return_url: return_url || `${FRONTEND_URL}/profile.html?stripe=return`
    };

    let accountId = '';
    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) throw new Error('User not found');

    if (!user.stripe_account_id) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'NZ',
        email: user.email,
        business_type: 'individual',
        metadata: {
          user_id: user.id,
          user_email: user.email
        }
      });
      user.stripe_account_id = account.id;
      accountId = account.id;
      writeDb(db);
    } else {
      accountId = user.stripe_account_id;
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: urls.refresh_url,
      return_url: urls.return_url,
      type: 'account_onboarding'
    });

    res.json({ url: link.url, account_id: accountId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to start Stripe onboarding' });
  }
});

app.get('/stripe/connect/status', authRequired, async (req, res) => {
  try {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.stripe_account_id) return res.json({ configured: false, user: publicUser(user) });
    if (!stripe) return res.json({ configured: true, stripe_available: false, user: publicUser(user) });

    const refreshed = await refreshStripeAccountState(req.user.id);
    res.json({ configured: true, stripe_available: true, user: refreshed?.user || publicUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load Stripe account status' });
  }
});


app.get('/stripe/connect/dashboard-link', authRequired, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured yet on the backend' });
    }

    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.stripe_account_id) {
      return res.status(400).json({ error: 'Stripe is not connected for this profile yet' });
    }

    const link = await stripe.accounts.createLoginLink(user.stripe_account_id);
    res.json({ url: link.url });
  } catch (error) {
    console.error('Unable to create Stripe dashboard link', error);
    res.status(500).json({ error: 'Unable to create Stripe dashboard access link' });
  }
});

app.get('/stripe/connect/summary', authRequired, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured yet on the backend' });
    }

    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.stripe_account_id) {
      return res.status(400).json({ error: 'Stripe is not connected for this profile yet' });
    }

    await refreshStripeAccountState(req.user.id);

    const [account, balance, payouts, balanceTransactions] = await Promise.all([
      stripe.accounts.retrieve(user.stripe_account_id),
      stripe.balance.retrieve({}, { stripeAccount: user.stripe_account_id }),
      stripe.payouts.list({ limit: 5 }, { stripeAccount: user.stripe_account_id }),
      stripe.balanceTransactions.list({ limit: 10 }, { stripeAccount: user.stripe_account_id })
    ]);

    const ownedProjectIds = new Set(
      db.projects.filter((project) => project.created_by === req.user.id).map((project) => project.id)
    );

    const localDonations = db.donations
      .filter((donation) => donation.payment_status === 'paid' && donation.project_id && ownedProjectIds.has(donation.project_id))
      .sort((a, b) => String(b.processed_at || b.created_at).localeCompare(String(a.processed_at || a.created_at)))
      .slice(0, 10)
      .map((donation) => ({
        id: donation.id,
        donor_name: donation.donor_name || 'Anonymous',
        donor_email: donation.donor_email || '',
        donor_message: donation.donor_message || '',
        amount_project: Number(donation.amount_project || 0),
        amount_platform: Number(donation.amount_platform || 0),
        currency: String(donation.currency || CURRENCY).toUpperCase(),
        project_id: donation.project_id || '',
        processed_at: donation.processed_at || null,
        created_at: donation.created_at || null,
        stripe_payment_intent_id: donation.stripe_payment_intent_id || '',
        stripe_session_id: donation.stripe_session_id || ''
      }));

    const totalReceivedLocal = db.donations
      .filter((donation) => donation.payment_status === 'paid' && donation.project_id && ownedProjectIds.has(donation.project_id))
      .reduce((sum, donation) => sum + Number(donation.amount_project || 0), 0);

    res.json({
      account: {
        id: user.stripe_account_id,
        charges_enabled: Boolean(account.charges_enabled),
        payouts_enabled: Boolean(account.payouts_enabled),
        details_submitted: Boolean(account.details_submitted),
        default_currency: String(account.default_currency || CURRENCY).toUpperCase()
      },
      balance: {
        currency: String(CURRENCY || 'nzd').toUpperCase(),
        available: sumStripeBalanceAmounts(balance.available, CURRENCY) / 100,
        pending: sumStripeBalanceAmounts(balance.pending, CURRENCY) / 100,
        instant_available: sumStripeBalanceAmounts(balance.instant_available || [], CURRENCY) / 100
      },
      payouts: (payouts.data || []).map((item) => ({
        id: item.id,
        amount: Number(item.amount || 0) / 100,
        currency: String(item.currency || CURRENCY).toUpperCase(),
        arrival_date: item.arrival_date ? new Date(item.arrival_date * 1000).toISOString() : null,
        created: item.created ? new Date(item.created * 1000).toISOString() : null,
        description: item.description || '',
        method: item.method || '',
        status: item.status || '',
        type: item.type || ''
      })),
      recent_transactions: (balanceTransactions.data || []).map(mapStripeBalanceTransaction),
      local_summary: {
        total_received: totalReceivedLocal,
        currency: String(CURRENCY || 'nzd').toUpperCase(),
        paid_donations_count: db.donations.filter((donation) => donation.payment_status === 'paid' && donation.project_id && ownedProjectIds.has(donation.project_id)).length,
        recent_donations: localDonations
      }
    });
  } catch (error) {
    console.error('Unable to load Stripe summary', error);
    res.status(500).json({ error: 'Unable to load Stripe summary' });
  }
});

app.post('/stripe/connect/disconnect', authRequired, (req, res) => {
  const result = withDb((db) => {
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user) return null;

    user.stripe_account_id = '';
    user.stripe_onboarding_complete = false;
    user.stripe_charges_enabled = false;
    user.stripe_payouts_enabled = false;
    user.stripe_details_submitted = false;

    for (const project of db.projects) {
      if (project.created_by === req.user.id) {
        project.owner_can_receive_payments = false;
      }
    }

    return publicUser(user);
  });

  if (!result) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Stripe disconnected', user: result });
});

app.get(['/projects','/api/projects'], (req, res) => {
  const { country, continent, helpType, category, q, financialOnly, reviewedOnly, verifiedOnly } = req.query;
  const db = readDb();

  let items = db.projects.filter((project) => isProjectPubliclyVisible(project));

  if (country) items = items.filter((project) => project.country === country);
  if (continent) items = items.filter((project) => project.continent === continent);
  if (category) items = items.filter((project) => project.category === category);
  if (financialOnly === '1') items = items.filter((project) => project.needs_financial_support && project.funding_approved);
  if (reviewedOnly === '1') items = items.filter((project) => project.admin_reviewed);
  if (verifiedOnly === '1') items = items.filter((project) => project.verified_ministry);
  if (helpType) items = items.filter((project) => Array.isArray(project.help_types) && project.help_types.includes(helpType));

  if (q) {
    const term = String(q).trim().toLowerCase();
    items = items.filter((project) => [
      project.title,
      project.summary,
      project.description,
      project.requester_name,
      project.organization_name,
      project.country,
      project.continent,
      project.category,
      ...(Array.isArray(project.project_links) ? project.project_links : [])
    ].some((value) => String(value || '').toLowerCase().includes(term)));
  }

  items = items.map((project) => {
    const prayer_count = db.prayers.filter((item) => item.project_id === project.id).length;
    const reply_count = db.replies.filter((item) => item.project_id === project.id).length;

    return {
      ...clone(project),
      prayer_count,
      reply_count
    };
  });

  items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ items: clone(items) });
});

app.get(['/projects/:id','/api/projects/:id'], (req, res) => {
  const db = readDb();
  const project = db.projects.find((item) => item.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Request not found' });

  const actorUser = extractBearerUser(req);
  const canViewPrivateResponses = Boolean(actorUser && (actorUser.id === project.created_by || actorUser.role === 'admin'));
  const showResponses = project.responses_public !== false || canViewPrivateResponses;

  const prayers = showResponses
    ? db.prayers
        .filter((item) => item.project_id === req.params.id)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 20)
    : [];

  const replies = showResponses
    ? db.replies
        .filter((item) => item.project_id === req.params.id)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 20)
    : [];

  const updates = db.updates
    .filter((item) => item.project_id === req.params.id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 20);

  res.json({
    project: clone(project),
    prayers: clone(prayers),
    replies: clone(replies),
    updates: clone(updates),
    response_visibility: {
      responses_public: project.responses_public !== false,
      can_view_private_responses: canViewPrivateResponses,
      showing_responses: showResponses
    },
    stats: {
      prayer_count: db.prayers.filter((item) => item.project_id === req.params.id).length,
      reply_count: db.replies.filter((item) => item.project_id === req.params.id).length
    }
  });
});

app.post('/projects', authRequired, (req, res) => {
  const body = req.body || {};
  const required = ['title', 'description', 'country', 'category', 'campaign_expiry_date'];

  for (const field of required) {
    if (!body[field]) return res.status(400).json({ error: `${field} is required` });
  }

  const helpTypes = Array.isArray(body.help_types) ? body.help_types.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const needsFinancialSupport = helpTypes.some((item) => item.toLowerCase() === 'financial support');
  const isAnonymous = !needsFinancialSupport && Boolean(body.is_anonymous);
  const responsesPublic = body.responses_public !== false;
  const db = readDb();
  const owner = db.users.find((item) => item.id === req.user.id);

  if (!owner || owner.is_active === false) {
    return res.status(403).json({ error: 'Account is not active' });
  }

  const continent = String(body.continent || detectContinentFromCountry(body.country) || '').trim();
  if (!continent) {
    return res.status(400).json({ error: 'continent is required' });
  }

  const projectLinks = Array.isArray(body.project_links)
    ? body.project_links.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  let fundingGoal = Number(body.funding_goal || 0);
  let fundingGoalCurrency = String(body.funding_goal_currency || '').trim();
  let campaignExpiryDate = String(body.campaign_expiry_date || '').trim();

  if (!campaignExpiryDate) {
    return res.status(400).json({ error: 'Campaign expiry date is required for all requests' });
  }

  const expiry = new Date(`${campaignExpiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) {
    return res.status(400).json({ error: 'Campaign expiry date is invalid' });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (expiry < today) {
    return res.status(400).json({ error: 'Campaign expiry date cannot be in the past' });
  }

  if (needsFinancialSupport) {
    if (body.is_anonymous) {
      return res.status(400).json({ error: 'Anonymous is not allowed for requests with financial support' });
    }

    if (!owner.stripe_account_id || !owner.stripe_charges_enabled) {
      return res.status(400).json({ error: 'Connect and finish Stripe onboarding in your profile before submitting a financial request' });
    }

    if (owner.allow_financial_support === false) {
      return res.status(400).json({ error: 'Your profile does not currently allow financial support' });
    }

    if (!(fundingGoal > 0)) {
      return res.status(400).json({ error: 'Funding goal must be greater than 0 for financial requests' });
    }

    fundingGoalCurrency = 'USD';

  } else {
    fundingGoal = 0;
    fundingGoalCurrency = '';
  }

  const projectId = withDb((state) => {
    const project = normalizeProject({
      id: createId(),
      title: String(body.title),
      summary: String(body.summary || body.description),
      description: String(body.description),
      country: String(body.country),
      continent,
      city: String(body.city || ''),
      category: String(body.category),
      help_types: helpTypes,
      requester_name: String(isAnonymous ? 'Anonymous' : (owner.name || owner.organization_name || 'Request owner')),
      organization_name: String(isAnonymous ? '' : (owner.organization_name || owner.name || '')),
      church_ministry_linked: '',
      contact_email: String(owner.email || ''),
      is_anonymous: isAnonymous,
      responses_public: responsesPublic,
      urgency: 'normal',
      is_online: Boolean(body.is_online),
      needs_financial_support: needsFinancialSupport,
      funding_goal: fundingGoal,
      funding_goal_currency: fundingGoalCurrency,
      campaign_expiry_date: campaignExpiryDate,
      project_links: projectLinks,
      funding_approved: needsFinancialSupport ? false : true,
      amount_raised: 0,
      admin_reviewed: needsFinancialSupport ? false : true,
      verified_ministry: false,
      status: 'active',
      timeline: '',
      who_benefits: '',
      why_it_matters: String(body.why_it_matters || ''),
      created_by: req.user.id,
      created_at: now(),
      owner_can_receive_payments: Boolean(owner?.stripe_charges_enabled && owner?.allow_financial_support !== false),
      archived: false,
      excluded: false
    });

    state.projects.push(project);
    state.updates.push({
      id: createId(),
      project_id: project.id,
      title: 'Request submitted',
      content: needsFinancialSupport
        ? 'This request has been submitted and is waiting for admin review for financial support. Stripe is already connected for this profile.'
        : 'This request has been submitted successfully and is already visible publicly.',
      created_at: now()
    });

    return project.id;
  });

  res.status(201).json({ id: projectId, message: 'Request created successfully' });
});

app.post('/projects/:id/archive', authRequired, (req, res) => {
  const result = withDb((db) => {
    const lookup = getOwnedProjectOr403(db, req.params.id, req.user.id);
    if (lookup.error) return lookup;

    lookup.project.archived = true;
    lookup.project.status = 'archived';
    return { project: clone(lookup.project) };
  });

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({ message: 'Request archived', project: result.project });
});

app.post('/projects/:id/restore', authRequired, (req, res) => {
  const result = withDb((db) => {
    const lookup = getOwnedProjectOr403(db, req.params.id, req.user.id);
    if (lookup.error) return lookup;

    lookup.project.archived = false;
    if (lookup.project.status === 'archived' || lookup.project.status === 'inactive') {
      lookup.project.status = 'active';
    }
    return { project: clone(lookup.project) };
  });

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({ message: 'Request restored', project: result.project });
});

app.post('/projects/:id/exclude', authRequired, (req, res) => {
  const result = withDb((db) => {
    const lookup = getOwnedProjectOr403(db, req.params.id, req.user.id);
    if (lookup.error) return lookup;

    lookup.project.excluded = true;
    return { project: clone(lookup.project) };
  });

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({ message: 'Request excluded', project: result.project });
});

app.post('/projects/:id/include', authRequired, (req, res) => {
  const result = withDb((db) => {
    const lookup = getOwnedProjectOr403(db, req.params.id, req.user.id);
    if (lookup.error) return lookup;

    lookup.project.excluded = false;
    return { project: clone(lookup.project) };
  });

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({ message: 'Request included', project: result.project });
});

app.post('/projects/:id/respond', async (req, res) => {
  const actorUser = extractBearerUser(req);
  const result = withDb((db) => createProjectResponse(db, req.params.id, req.body || {}));

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });

  const db = readDb();
  const project = db.projects.find((item) => item.id === req.params.id);
  await handleProjectResponseNotifications({ kind: result.kind, project, item: result.item, actorUser });

  res.json({
    message: result.message,
    kind: result.kind,
    item: result.item
  });
});

app.post('/projects/:id/pray', async (req, res) => {
  const body = { ...(req.body || {}), kind: 'prayer' };
  const actorUser = extractBearerUser(req);
  const result = withDb((db) => createProjectResponse(db, req.params.id, body));

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
  const db = readDb();
  const project = db.projects.find((item) => item.id === req.params.id);
  await handleProjectResponseNotifications({ kind: result.kind, project, item: result.item, actorUser });
  res.json({ message: result.message, kind: result.kind, item: result.item });
});

app.post('/projects/:id/reply', async (req, res) => {
  const body = { ...(req.body || {}), kind: 'reply' };
  const actorUser = extractBearerUser(req);
  const result = withDb((db) => createProjectResponse(db, req.params.id, body));

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
  const db = readDb();
  const project = db.projects.find((item) => item.id === req.params.id);
  await handleProjectResponseNotifications({ kind: result.kind, project, item: result.item, actorUser });
  res.json({ message: result.message, kind: result.kind, item: result.item });
});

app.post('/projects/:id/report', (req, res) => {
  const { reason, details } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'Reason is required' });

  withDb((db) => {
    db.reports.push({
      id: createId(),
      project_id: req.params.id,
      reason,
      details: details || '',
      created_at: now()
    });
  });

  res.json({ message: 'Report submitted successfully' });
});

app.get('/admin/projects', authRequired, adminRequired, (req, res) => {
  const db = readDb();
  const items = [...db.projects].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ items: clone(items) });
});

app.post('/admin/projects/:id/review', authRequired, adminRequired, (req, res) => {
  const { funding_approved, admin_reviewed, verified_ministry, status, financial_denied, denied_reason, cancellation_reason } = req.body || {};

  const updated = withDb((db) => {
    const project = db.projects.find((item) => item.id === req.params.id);
    if (!project) return null;

    if (funding_approved !== undefined) {
      project.funding_approved = Boolean(funding_approved);
      if (project.funding_approved) {
        project.financial_denied = false;
        project.denied_reason = '';
      }
    }

    if (financial_denied !== undefined) {
      project.financial_denied = Boolean(financial_denied);
      if (project.financial_denied) {
        project.funding_approved = false;
        project.denied_reason = String(denied_reason || '').trim();
      } else if (denied_reason !== undefined) {
        project.denied_reason = String(denied_reason || '').trim();
      }
    } else if (denied_reason !== undefined) {
      project.denied_reason = String(denied_reason || '').trim();
    }

    if (admin_reviewed !== undefined) project.admin_reviewed = Boolean(admin_reviewed);
    if (verified_ministry !== undefined) project.verified_ministry = Boolean(verified_ministry);

    if (status !== undefined) {
      project.status = String(status);
      if (project.status === 'cancelled') {
        project.funding_approved = false;
        project.financial_denied = false;
        project.cancellation_reason = String(cancellation_reason || '').trim();
        project.cancelled_at = now();
      } else if (project.status === 'active') {
        project.cancellation_reason = '';
        project.cancelled_at = null;
      }
    } else if (cancellation_reason !== undefined) {
      project.cancellation_reason = String(cancellation_reason || '').trim();
    }

    return clone(project);
  });

  if (!updated) return res.status(404).json({ error: 'Request not found' });
  res.json({ message: 'Request updated', project: updated });
});

app.post('/payments/project-checkout', async (req, res) => {
  try {
    const { project_id, donor_name, donor_email, donor_message, amount_project, amount_platform } = req.body || {};
    const db = readDb();
    const project = db.projects.find((item) => item.id === project_id);
    if (!project) return res.status(404).json({ error: 'Request not found' });
    if (project.status !== 'active' || project.archived || project.excluded) {
      return res.status(400).json({ error: 'This request is not available for donations' });
    }
    if (!project.funding_approved) return res.status(400).json({ error: 'Financial support is not enabled for this request yet' });

    if (project.campaign_expiry_date) {
      const expiry = new Date(`${project.campaign_expiry_date}T23:59:59`);
      if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
        return res.status(400).json({ error: 'This fundraising campaign has expired' });
      }
    }

    const owner = db.users.find((item) => item.id === project.created_by);
    if (!owner?.stripe_account_id || !owner?.stripe_charges_enabled) {
      return res.status(400).json({ error: 'The request owner has not finished Stripe onboarding yet' });
    }

    const projectAmount = Number(amount_project || 0);
    const platformAmount = Number(amount_platform || 0);
    if (projectAmount <= 0 && platformAmount <= 0) {
      return res.status(400).json({ error: 'Enter a valid donation amount' });
    }

    const donation = withDb((state) => {
      const record = normalizeDonation({
        id: createId(),
        project_id,
        donor_name: donor_name || 'Anonymous',
        donor_email: donor_email || '',
        donor_message: String(donor_message || '').trim(),
        amount_project: projectAmount,
        amount_platform: platformAmount,
        currency: CURRENCY,
        stripe_session_id: '',
        stripe_account_id: owner.stripe_account_id,
        payment_status: 'pending',
        donation_type: 'project',
        created_at: now()
      });
      state.donations.push(record);
      return clone(record);
    });

    if (!stripe) {
      return res.json({
        demo_mode: true,
        message: 'Stripe is not configured yet. Donation recorded in demo mode.',
        donation_id: donation.id
      });
    }

    const totalAmount = Math.round((projectAmount + platformAmount) * 100);
    const applicationFee = Math.max(0, Math.round(platformAmount * 100));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: CURRENCY,
          product_data: { name: `Support: ${project.title}` },
          unit_amount: totalAmount
        },
        quantity: 1
      }],
      success_url: `${FRONTEND_URL}/success.html?type=project&session_id={CHECKOUT_SESSION_ID}&project_id=${encodeURIComponent(project_id)}`,
      cancel_url: `${FRONTEND_URL}/project.html?id=${project_id}`,
      customer_email: donor_email || undefined,
      payment_intent_data: {
        application_fee_amount: applicationFee || undefined,
        transfer_data: {
          destination: owner.stripe_account_id
        },
        description: donor_message
          ? `Support for ${project.title} — ${String(donor_message).trim().slice(0, 180)}`
          : `Support for ${project.title}`
      },
      metadata: {
        donation_id: donation.id,
        project_id: project_id,
        owner_user_id: owner.id,
        donation_type: 'project',
        donor_message: String(donor_message || '').trim().slice(0, 300)
      }
    });

    withDb((state) => {
      const target = state.donations.find((item) => item.id === donation.id);
      if (target) target.stripe_session_id = session.id;
    });

    res.json({ url: session.url, session_id: session.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to create checkout session' });
  }
});

app.post('/payments/platform-checkout', async (req, res) => {
  try {
    const { donor_name, donor_email, amount_platform } = req.body || {};
    const platformAmount = Number(amount_platform || 0);
    if (platformAmount <= 0) return res.status(400).json({ error: 'Enter a valid amount' });

    const donation = withDb((state) => {
      const record = normalizeDonation({
        id: createId(),
        project_id: null,
        donor_name: donor_name || 'Anonymous',
        donor_email: donor_email || '',
        amount_project: 0,
        amount_platform: platformAmount,
        currency: CURRENCY,
        stripe_session_id: '',
        stripe_account_id: '',
        payment_status: 'pending',
        donation_type: 'platform',
        created_at: now()
      });
      state.donations.push(record);
      return clone(record);
    });

    if (!stripe) {
      return res.json({
        demo_mode: true,
        message: 'Stripe is not configured yet. Platform support recorded in demo mode.',
        donation_id: donation.id
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: CURRENCY,
          product_data: { name: 'Support ChristHelper' },
          unit_amount: Math.round(platformAmount * 100)
        },
        quantity: 1
      }],
      success_url: `${FRONTEND_URL}/success.html?type=platform&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/help-christhelper.html`,
      customer_email: donor_email || undefined,
      metadata: { donation_id: donation.id, donation_type: 'platform' }
    });

    withDb((state) => {
      const target = state.donations.find((item) => item.id === donation.id);
      if (target) target.stripe_session_id = session.id;
    });

    res.json({ url: session.url, session_id: session.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to create checkout session' });
  }
});

app.get('/payments/confirm-session', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured yet on the backend' });
    }

    const sessionId = String(req.query.session_id || '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'session_id is required' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const donationId = session.metadata?.donation_id || '';
    if (!donationId) {
      return res.status(404).json({ error: 'Donation metadata not found for this session' });
    }

    let result = null;

    withDb((db) => {
      const donation = db.donations.find((item) => item.id === donationId);
      if (!donation) {
        result = { error: 'Donation not found', status: 404 };
        return;
      }

      donation.stripe_session_id = session.id;
      donation.checkout_session_status = String(session.payment_status || '');

      if (session.payment_status === 'paid') {
        const applied = applyPaidDonation(db, donation, session);
        result = {
          ok: true,
          payment_status: 'paid',
          already_processed: !applied.changed,
          donation: clone(donation),
          project_id: donation.project_id || null
        };
        if (applied.changed) {
          setTimeout(() => { handleDonationNotifications(clone(donation)); }, 0);
        }
        return;
      }

      result = {
        ok: true,
        payment_status: session.payment_status || 'unpaid',
        donation: clone(donation),
        project_id: donation.project_id || null
      };
    });

    if (result?.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('Confirm session failed:', error);
    res.status(500).json({ error: 'Unable to confirm Stripe session' });
  }
});

app.post('/webhook', (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.log('Webhook skipped: Stripe or STRIPE_WEBHOOK_SECRET not configured');
    return res.status(200).send('Webhook skipped');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Stripe webhook received:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const donationId = session.metadata?.donation_id;

    withDb((db) => {
      const donation = db.donations.find((item) => item.id === donationId);
      if (!donation) {
        console.log('Webhook donation not found for donation_id:', donationId);
        return;
      }

      const applied = applyPaidDonation(db, donation, session);
      if (applied.changed) {
        setTimeout(() => { handleDonationNotifications(clone(donation)); }, 0);
      }
      console.log('Donation processing result:', {
        donation_id: donation.id,
        changed: applied.changed,
        project_id: donation.project_id || null,
        reason: applied.reason || ''
      });
    });
  }

  if (event.type === 'account.updated') {
    const account = event.data.object;
    withDb((db) => {
      const user = db.users.find((item) => item.stripe_account_id === account.id);
      if (!user) return;

      user.stripe_details_submitted = Boolean(account.details_submitted);
      user.stripe_charges_enabled = Boolean(account.charges_enabled);
      user.stripe_payouts_enabled = Boolean(account.payouts_enabled);
      user.stripe_onboarding_complete = Boolean(account.details_submitted && account.charges_enabled);
    });
  }

  res.json({ received: true });
});

app.get('/admin/users', authRequired, adminRequired, (req, res) => {
  const db = readDb();
  const items = [...db.users]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map((user) => getAdminUserView(db, user));
  res.json({ items: clone(items) });
});

app.post('/admin/users/:id/inactivate', authRequired, adminRequired, (req, res) => {
  const updated = withDb((db) => {
    const user = db.users.find((item) => item.id === req.params.id);
    if (!user) return { error: 'User not found', status: 404 };
    if (user.id === req.user.id) return { error: 'You cannot inactivate your own admin account', status: 400 };

    user.is_active = false;
    user.deactivated_at = now();

    for (const project of db.projects) {
      if (project.created_by === user.id && String(project.status || 'active') === 'active') {
        project.status = 'inactive';
        project.archived = true;
      }
    }

    return { user: getAdminUserView(db, user) };
  });

  if (updated?.error) return res.status(updated.status || 400).json({ error: updated.error });
  res.json({ message: 'User inactivated', user: updated.user });
});

app.post('/admin/users/:id/activate', authRequired, adminRequired, (req, res) => {
  const updated = withDb((db) => {
    const user = db.users.find((item) => item.id === req.params.id);
    if (!user) return { error: 'User not found', status: 404 };

    user.is_active = true;
    user.deactivated_at = null;
    return { user: getAdminUserView(db, user) };
  });

  if (updated?.error) return res.status(updated.status || 400).json({ error: updated.error });
  res.json({ message: 'User activated', user: updated.user });
});

app.post('/admin/users/:id/promote', authRequired, adminRequired, (req, res) => {
  const updated = withDb((db) => {
    const user = db.users.find((item) => item.id === req.params.id);
    if (!user) return { error: 'User not found', status: 404 };

    user.role = 'admin';
    return { user: getAdminUserView(db, user) };
  });

  if (updated?.error) return res.status(updated.status || 400).json({ error: updated.error });
  res.json({ message: 'User promoted to admin', user: updated.user });
});

app.delete('/admin/users/:id', authRequired, adminRequired, (req, res) => {
  const updated = withDb((db) => {
    const userIndex = db.users.findIndex((item) => item.id === req.params.id);
    if (userIndex === -1) return { error: 'User not found', status: 404 };

    const user = db.users[userIndex];
    if (user.id === req.user.id) return { error: 'You cannot delete your own admin account', status: 400 };
    if (String(user.role || '') === 'admin') return { error: 'Delete is blocked for admin users. Inactivate the account instead.', status: 400 };

    const ownsProjects = db.projects.some((project) => project.created_by === user.id);
    if (ownsProjects) {
      return { error: 'This user already owns projects. Inactivate the account instead of deleting it.', status: 400 };
    }

    db.users.splice(userIndex, 1);
    return { ok: true };
  });

  if (updated?.error) return res.status(updated.status || 400).json({ error: updated.error });
  res.json({ message: 'User deleted' });
});

app.get('/admin/donations', authRequired, adminRequired, (req, res) => {
  const db = readDb();
  const items = [...db.donations].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ items: clone(items) });
});

readDb();

app.listen(PORT, () => {
  console.log(`ChristHelper backend running on http://localhost:${PORT}`);
  console.log(`Frontend URL: ${FRONTEND_URL}`);
  console.log(`SQLite DB path: ${DB_PATH}`);
  console.log(`Legacy data file path: ${LEGACY_DATA_FILE}`);
  console.log(`Stripe configured: ${Boolean(stripe)}`);
  console.log(`Webhook secret configured: ${Boolean(process.env.STRIPE_WEBHOOK_SECRET)}`);
  console.log('Demo admin: admin@christhelper.local / admin123');
});
