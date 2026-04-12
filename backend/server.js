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
    deactivated_at: user.deactivated_at || null
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
  if (!project) return { error: 'Project not found', status: 404 };
  if (project.created_by !== userId) return { error: 'You do not have permission to modify this project', status: 403 };
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
  if (!project) return { error: 'Project not found', status: 404 };

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
    webhook_secret_configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET)
  });
});

app.post('/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

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
      created_at: now()
    });

    db.users.push(user);
    return publicUser(user);
  });

  if (!createdUser) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const token = jwt.sign(createdUser, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: createdUser });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const db = readDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = db.users.find((item) => item.email === normalizedEmail);

  if (!user || user.is_active === false || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

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
        if (user.organization_name && !project.organization_name) {
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
  const { country, continent, helpType, category, q, financialOnly, reviewedOnly, verifiedOnly, urgency } = req.query;
  const db = readDb();

  let items = db.projects.filter((project) => project.status === 'active' && !project.archived && !project.excluded);

  if (country) items = items.filter((project) => project.country === country);
  if (continent) items = items.filter((project) => project.continent === continent);
  if (category) items = items.filter((project) => project.category === category);
  if (urgency) items = items.filter((project) => project.urgency === urgency);
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
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const prayers = db.prayers
    .filter((item) => item.project_id === req.params.id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 20);

  const replies = db.replies
    .filter((item) => item.project_id === req.params.id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 20);

  const updates = db.updates
    .filter((item) => item.project_id === req.params.id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 20);

  res.json({
    project: clone(project),
    prayers: clone(prayers),
    replies: clone(replies),
    updates: clone(updates),
    stats: {
      prayer_count: db.prayers.filter((item) => item.project_id === req.params.id).length,
      reply_count: db.replies.filter((item) => item.project_id === req.params.id).length
    }
  });
});

app.post('/projects', authRequired, (req, res) => {
  const body = req.body || {};
  const required = ['title', 'summary', 'description', 'country', 'category', 'requester_name', 'contact_email'];

  for (const field of required) {
    if (!body[field]) return res.status(400).json({ error: `${field} is required` });
  }

  const helpTypes = Array.isArray(body.help_types) ? body.help_types : [];
  const needsFinancialSupport = Boolean(body.needs_financial_support);
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

  if (needsFinancialSupport) {
    if (!owner.stripe_account_id || !owner.stripe_charges_enabled) {
      return res.status(400).json({ error: 'Connect and finish Stripe onboarding in your profile before submitting a financial project' });
    }

    if (owner.allow_financial_support === false) {
      return res.status(400).json({ error: 'Your profile does not currently allow financial support' });
    }

    if (!(fundingGoal > 0)) {
      return res.status(400).json({ error: 'Funding goal must be greater than 0 for financial projects' });
    }

    fundingGoalCurrency = 'USD';

    if (!campaignExpiryDate) {
      return res.status(400).json({ error: 'Campaign expiry date is required for financial projects' });
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
  } else {
    fundingGoal = 0;
    fundingGoalCurrency = '';
    campaignExpiryDate = '';
  }

  const projectId = withDb((state) => {
    const project = normalizeProject({
      id: createId(),
      title: String(body.title),
      summary: String(body.summary),
      description: String(body.description),
      country: String(body.country),
      continent,
      city: String(body.city || ''),
      category: String(body.category),
      help_types: helpTypes,
      requester_name: String(body.requester_name),
      organization_name: String(body.organization_name || owner.organization_name || ''),
      church_ministry_linked: String(body.church_ministry_linked || ''),
      contact_email: String(body.contact_email),
      urgency: String(body.urgency || 'normal'),
      is_online: Boolean(body.is_online),
      needs_financial_support: needsFinancialSupport,
      funding_goal: fundingGoal,
      funding_goal_currency: fundingGoalCurrency,
      campaign_expiry_date: campaignExpiryDate,
      project_links: projectLinks,
      funding_approved: false,
      amount_raised: 0,
      admin_reviewed: false,
      verified_ministry: false,
      status: 'active',
      timeline: String(body.timeline || ''),
      who_benefits: String(body.who_benefits || ''),
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
      title: 'Project submitted',
      content: needsFinancialSupport
        ? 'This project has been submitted and is waiting for admin review for financial support. Stripe is already connected for this profile.'
        : 'This project has been submitted successfully.',
      created_at: now()
    });

    return project.id;
  });

  res.status(201).json({ id: projectId, message: 'Project created successfully' });
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
  res.json({ message: 'Project archived', project: result.project });
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
  res.json({ message: 'Project restored', project: result.project });
});

app.post('/projects/:id/exclude', authRequired, (req, res) => {
  const result = withDb((db) => {
    const lookup = getOwnedProjectOr403(db, req.params.id, req.user.id);
    if (lookup.error) return lookup;

    lookup.project.excluded = true;
    return { project: clone(lookup.project) };
  });

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({ message: 'Project excluded', project: result.project });
});

app.post('/projects/:id/include', authRequired, (req, res) => {
  const result = withDb((db) => {
    const lookup = getOwnedProjectOr403(db, req.params.id, req.user.id);
    if (lookup.error) return lookup;

    lookup.project.excluded = false;
    return { project: clone(lookup.project) };
  });

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({ message: 'Project included', project: result.project });
});

app.post('/projects/:id/respond', (req, res) => {
  const result = withDb((db) => createProjectResponse(db, req.params.id, req.body || {}));

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({
    message: result.message,
    kind: result.kind,
    item: result.item
  });
});

app.post('/projects/:id/pray', (req, res) => {
  const body = { ...(req.body || {}), kind: 'prayer' };
  const result = withDb((db) => createProjectResponse(db, req.params.id, body));

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({ message: result.message, kind: result.kind, item: result.item });
});

app.post('/projects/:id/reply', (req, res) => {
  const body = { ...(req.body || {}), kind: 'reply' };
  const result = withDb((db) => createProjectResponse(db, req.params.id, body));

  if (result?.error) return res.status(result.status || 400).json({ error: result.error });
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

  if (!updated) return res.status(404).json({ error: 'Project not found' });
  res.json({ message: 'Project updated', project: updated });
});

app.post('/payments/project-checkout', async (req, res) => {
  try {
    const { project_id, donor_name, donor_email, donor_message, amount_project, amount_platform } = req.body || {};
    const db = readDb();
    const project = db.projects.find((item) => item.id === project_id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.status !== 'active' || project.archived || project.excluded) {
      return res.status(400).json({ error: 'This project is not available for donations' });
    }
    if (!project.funding_approved) return res.status(400).json({ error: 'Financial support is not enabled for this project yet' });

    if (project.campaign_expiry_date) {
      const expiry = new Date(`${project.campaign_expiry_date}T23:59:59`);
      if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
        return res.status(400).json({ error: 'This fundraising campaign has expired' });
      }
    }

    const owner = db.users.find((item) => item.id === project.created_by);
    if (!owner?.stripe_account_id || !owner?.stripe_charges_enabled) {
      return res.status(400).json({ error: 'The project owner has not finished Stripe onboarding yet' });
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
