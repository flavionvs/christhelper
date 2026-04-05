require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'christhelper.db');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5500';
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const CURRENCY = process.env.STRIPE_CURRENCY || 'nzd';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'supporter',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      description TEXT NOT NULL,
      country TEXT NOT NULL,
      continent TEXT NOT NULL,
      city TEXT,
      category TEXT NOT NULL,
      help_types TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      organization_name TEXT,
      church_ministry_linked TEXT,
      contact_email TEXT NOT NULL,
      urgency TEXT NOT NULL DEFAULT 'normal',
      is_online INTEGER NOT NULL DEFAULT 0,
      needs_financial_support INTEGER NOT NULL DEFAULT 0,
      funding_goal REAL NOT NULL DEFAULT 0,
      funding_approved INTEGER NOT NULL DEFAULT 0,
      amount_raised REAL NOT NULL DEFAULT 0,
      admin_reviewed INTEGER NOT NULL DEFAULT 0,
      verified_ministry INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      timeline TEXT,
      who_benefits TEXT,
      why_it_matters TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS prayers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      donor_name TEXT,
      donor_email TEXT,
      amount_project REAL NOT NULL DEFAULT 0,
      amount_platform REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT '${CURRENCY}',
      stripe_session_id TEXT,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      donation_type TEXT NOT NULL DEFAULT 'project',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
  `);

  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@christhelper.local');
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('ChristHelper Admin', 'admin@christhelper.local', hash, 'admin');
  }

  const count = db.prepare('SELECT COUNT(*) as total FROM projects').get().total;
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO projects (
        title, summary, description, country, continent, city, category, help_types,
        requester_name, organization_name, church_ministry_linked, contact_email,
        urgency, is_online, needs_financial_support, funding_goal, funding_approved,
        amount_raised, admin_reviewed, verified_ministry, timeline, who_benefits, why_it_matters
      ) VALUES (
        @title, @summary, @description, @country, @continent, @city, @category, @help_types,
        @requester_name, @organization_name, @church_ministry_linked, @contact_email,
        @urgency, @is_online, @needs_financial_support, @funding_goal, @funding_approved,
        @amount_raised, @admin_reviewed, @verified_ministry, @timeline, @who_benefits, @why_it_matters
      )
    `);

    const seedProjects = [
      {
        title: 'Youth Outreach Weekend in Auckland',
        summary: 'Local church seeking prayer, volunteers, and small funding support for a youth outreach weekend.',
        description: 'We are organizing a youth outreach weekend with worship, games, testimonies, and evangelism activities. We need volunteers, prayer covering, and support for transport and food.',
        country: 'New Zealand', continent: 'Oceania', city: 'Auckland', category: 'Youth ministry',
        help_types: JSON.stringify(['Prayer', 'Volunteer', 'Financial support']), requester_name: 'Pastor Daniel',
        organization_name: 'Hope Community Church', church_ministry_linked: 'Hope Community Church', contact_email: 'pastor@example.com',
        urgency: 'high', is_online: 0, needs_financial_support: 1, funding_goal: 1200, funding_approved: 1,
        amount_raised: 350, admin_reviewed: 1, verified_ministry: 1, timeline: 'May 2026',
        who_benefits: 'Teenagers and young adults in the community', why_it_matters: 'Many youth are disconnected from church and need hope, mentoring, and community.'
      },
      {
        title: 'Bible Distribution for Rural Families',
        summary: 'Mission project requesting prayer and financial support to distribute Bibles in remote communities.',
        description: 'A mission team is preparing a Bible distribution trip for remote communities with limited access to Christian resources. Support is needed for travel, printing, and prayer.',
        country: 'Brazil', continent: 'South America', city: 'Manaus', category: 'Bible distribution',
        help_types: JSON.stringify(['Prayer', 'Financial support', 'Guidance']), requester_name: 'Missionary Ana',
        organization_name: 'Grace Missions', church_ministry_linked: 'Grace Missions', contact_email: 'ana@example.com',
        urgency: 'normal', is_online: 0, needs_financial_support: 1, funding_goal: 2500, funding_approved: 1,
        amount_raised: 900, admin_reviewed: 1, verified_ministry: 0, timeline: 'June 2026',
        who_benefits: 'Families in remote river communities', why_it_matters: 'Access to Scripture is limited and many families have requested Bibles and study material.'
      },
      {
        title: 'Christian Media Website Launch',
        summary: 'A Christian media team needs mentorship, technical guidance, and prayer to launch a discipleship website.',
        description: 'We are building a Christian media website with articles, devotionals, and teaching resources. We need advice on launch strategy, content planning, and volunteers for editing.',
        country: 'United States', continent: 'North America', city: 'Online', category: 'Christian media',
        help_types: JSON.stringify(['Prayer', 'Mentorship', 'Services']), requester_name: 'Sarah Lee',
        organization_name: 'Light Online', church_ministry_linked: '', contact_email: 'sarah@example.com',
        urgency: 'low', is_online: 1, needs_financial_support: 0, funding_goal: 0, funding_approved: 0,
        amount_raised: 0, admin_reviewed: 1, verified_ministry: 0, timeline: 'Ongoing',
        who_benefits: 'Online readers and small groups', why_it_matters: 'Many people need accessible digital discipleship resources.'
      }
    ];

    const insertUpdate = db.prepare('INSERT INTO updates (project_id, title, content) VALUES (?, ?, ?)');
    for (const project of seedProjects) {
      const result = insert.run(project);
      insertUpdate.run(result.lastInsertRowid, 'Project created', 'Thank you for standing with this need. We will post updates as support comes in.');
    }
  }
}

initDb();

app.use(cors());
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function mapProject(row) {
  if (!row) return null;
  return {
    ...row,
    help_types: safeJsonParse(row.help_types, []),
    is_online: Boolean(row.is_online),
    needs_financial_support: Boolean(row.needs_financial_support),
    funding_approved: Boolean(row.funding_approved),
    admin_reviewed: Boolean(row.admin_reviewed),
    verified_ministry: Boolean(row.verified_ministry)
  };
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value || '[]');
  } catch {
    return fallback;
  }
}

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'christhelper-backend', time: new Date().toISOString() });
});

app.post('/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name.trim(), email.toLowerCase(), hash, 'supporter');

  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const payload = { id: user.id, name: user.name, email: user.email, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: payload });
});

app.get('/projects', (req, res) => {
  const { country, continent, helpType, category, q, financialOnly, reviewedOnly, verifiedOnly, urgency } = req.query;
  let sql = 'SELECT * FROM projects WHERE status = ?';
  const params = ['active'];

  if (country) {
    sql += ' AND country = ?';
    params.push(country);
  }
  if (continent) {
    sql += ' AND continent = ?';
    params.push(continent);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (urgency) {
    sql += ' AND urgency = ?';
    params.push(urgency);
  }
  if (financialOnly === '1') {
    sql += ' AND needs_financial_support = 1 AND funding_approved = 1';
  }
  if (reviewedOnly === '1') {
    sql += ' AND admin_reviewed = 1';
  }
  if (verifiedOnly === '1') {
    sql += ' AND verified_ministry = 1';
  }
  if (q) {
    sql += ' AND (title LIKE ? OR summary LIKE ? OR description LIKE ? OR requester_name LIKE ? OR organization_name LIKE ?)';
    const term = `%${q}%`;
    params.push(term, term, term, term, term);
  }
  sql += ' ORDER BY created_at DESC';

  let items = db.prepare(sql).all(...params).map(mapProject);
  if (helpType) {
    items = items.filter(p => p.help_types.includes(helpType));
  }
  res.json({ items });
});

app.get('/projects/:id', (req, res) => {
  const project = mapProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const prayers = db.prepare('SELECT * FROM prayers WHERE project_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
  const replies = db.prepare('SELECT * FROM replies WHERE project_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
  const updates = db.prepare('SELECT * FROM updates WHERE project_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id);

  res.json({
    project,
    prayers,
    replies,
    updates,
    stats: {
      prayer_count: db.prepare('SELECT COUNT(*) as total FROM prayers WHERE project_id = ?').get(req.params.id).total,
      reply_count: db.prepare('SELECT COUNT(*) as total FROM replies WHERE project_id = ?').get(req.params.id).total
    }
  });
});

app.post('/projects', authRequired, (req, res) => {
  const body = req.body || {};
  const required = ['title', 'summary', 'description', 'country', 'continent', 'category', 'requester_name', 'contact_email'];
  for (const field of required) {
    if (!body[field]) return res.status(400).json({ error: `${field} is required` });
  }

  const helpTypes = Array.isArray(body.help_types) ? body.help_types : [];
  const needsFinancialSupport = Boolean(body.needs_financial_support);
  const result = db.prepare(`
    INSERT INTO projects (
      title, summary, description, country, continent, city, category, help_types,
      requester_name, organization_name, church_ministry_linked, contact_email,
      urgency, is_online, needs_financial_support, funding_goal, funding_approved,
      amount_raised, admin_reviewed, verified_ministry, status, timeline, who_benefits,
      why_it_matters, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'active', ?, ?, ?, ?)
  `).run(
    body.title,
    body.summary,
    body.description,
    body.country,
    body.continent,
    body.city || '',
    body.category,
    JSON.stringify(helpTypes),
    body.requester_name,
    body.organization_name || '',
    body.church_ministry_linked || '',
    body.contact_email,
    body.urgency || 'normal',
    body.is_online ? 1 : 0,
    needsFinancialSupport ? 1 : 0,
    Number(body.funding_goal || 0),
    needsFinancialSupport ? 0 : 0,
    body.timeline || '',
    body.who_benefits || '',
    body.why_it_matters || '',
    req.user.id
  );

  const projectId = result.lastInsertRowid;
  db.prepare('INSERT INTO updates (project_id, title, content) VALUES (?, ?, ?)')
    .run(projectId, 'Project submitted', needsFinancialSupport
      ? 'This project has been submitted and is waiting for admin review for financial support.'
      : 'This project has been submitted successfully.');

  res.status(201).json({ id: projectId, message: 'Project created successfully' });
});

app.post('/projects/:id/pray', (req, res) => {
  const { name, message } = req.body || {};
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  db.prepare('INSERT INTO prayers (project_id, name, message) VALUES (?, ?, ?)')
    .run(req.params.id, name || 'Anonymous', message || 'Prayed for this project.');
  res.json({ message: 'Prayer support recorded' });
});

app.post('/projects/:id/reply', (req, res) => {
  const { type, name, email, message } = req.body || {};
  if (!type || !name || !message) {
    return res.status(400).json({ error: 'Type, name and message are required' });
  }
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  db.prepare('INSERT INTO replies (project_id, type, name, email, message) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, type, name, email || '', message);
  res.json({ message: 'Support offer sent' });
});

app.post('/projects/:id/report', (req, res) => {
  const { reason, details } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'Reason is required' });
  db.prepare('INSERT INTO reports (project_id, reason, details) VALUES (?, ?, ?)')
    .run(req.params.id, reason, details || '');
  res.json({ message: 'Report submitted successfully' });
});

app.get('/admin/projects', authRequired, adminRequired, (req, res) => {
  const items = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all().map(mapProject);
  res.json({ items });
});

app.post('/admin/projects/:id/review', authRequired, adminRequired, (req, res) => {
  const { funding_approved, admin_reviewed, verified_ministry, status } = req.body || {};
  db.prepare(`
    UPDATE projects
    SET funding_approved = COALESCE(?, funding_approved),
        admin_reviewed = COALESCE(?, admin_reviewed),
        verified_ministry = COALESCE(?, verified_ministry),
        status = COALESCE(?, status)
    WHERE id = ?
  `).run(
    funding_approved === undefined ? null : (funding_approved ? 1 : 0),
    admin_reviewed === undefined ? null : (admin_reviewed ? 1 : 0),
    verified_ministry === undefined ? null : (verified_ministry ? 1 : 0),
    status || null,
    req.params.id
  );

  res.json({ message: 'Project updated' });
});

app.post('/payments/project-checkout', async (req, res) => {
  try {
    const { project_id, donor_name, donor_email, amount_project, amount_platform } = req.body || {};
    const project = mapProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(project_id));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.funding_approved) return res.status(400).json({ error: 'Financial support is not enabled for this project yet' });

    const projectAmount = Number(amount_project || 0);
    const platformAmount = Number(amount_platform || 0);
    if (projectAmount <= 0 && platformAmount <= 0) {
      return res.status(400).json({ error: 'Enter a valid donation amount' });
    }

    const donation = db.prepare(`
      INSERT INTO donations (project_id, donor_name, donor_email, amount_project, amount_platform, payment_status, donation_type)
      VALUES (?, ?, ?, ?, ?, 'pending', 'project')
    `).run(project_id, donor_name || 'Anonymous', donor_email || '', projectAmount, platformAmount);

    if (!stripe) {
      return res.json({
        demo_mode: true,
        message: 'Stripe is not configured yet. Donation recorded in demo mode.',
        donation_id: donation.lastInsertRowid
      });
    }

    const line_items = [];
    if (projectAmount > 0) {
      line_items.push({
        price_data: {
          currency: CURRENCY,
          product_data: { name: `Support: ${project.title}` },
          unit_amount: Math.round(projectAmount * 100)
        },
        quantity: 1
      });
    }
    if (platformAmount > 0) {
      line_items.push({
        price_data: {
          currency: CURRENCY,
          product_data: { name: 'Support ChristHelper' },
          unit_amount: Math.round(platformAmount * 100)
        },
        quantity: 1
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      success_url: `${FRONTEND_URL}/success.html?type=project`,
      cancel_url: `${FRONTEND_URL}/project.html?id=${project_id}`,
      customer_email: donor_email || undefined,
      metadata: {
        donation_id: String(donation.lastInsertRowid),
        project_id: String(project_id)
      }
    });

    db.prepare('UPDATE donations SET stripe_session_id = ? WHERE id = ?').run(session.id, donation.lastInsertRowid);
    res.json({ url: session.url });
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

    const donation = db.prepare(`
      INSERT INTO donations (donor_name, donor_email, amount_project, amount_platform, payment_status, donation_type)
      VALUES (?, ?, 0, ?, 'pending', 'platform')
    `).run(donor_name || 'Anonymous', donor_email || '', platformAmount);

    if (!stripe) {
      return res.json({
        demo_mode: true,
        message: 'Stripe is not configured yet. Platform support recorded in demo mode.',
        donation_id: donation.lastInsertRowid
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
      success_url: `${FRONTEND_URL}/success.html?type=platform`,
      cancel_url: `${FRONTEND_URL}/help-christhelper.html`,
      customer_email: donor_email || undefined,
      metadata: { donation_id: String(donation.lastInsertRowid), donation_type: 'platform' }
    });

    db.prepare('UPDATE donations SET stripe_session_id = ? WHERE id = ?').run(session.id, donation.lastInsertRowid);
    res.json({ url: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to create checkout session' });
  }
});

app.post('/webhook', (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(200).send('Webhook skipped');
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const donationId = Number(session.metadata?.donation_id || 0);
    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(donationId);
    if (donation) {
      db.prepare('UPDATE donations SET payment_status = ? WHERE id = ?').run('paid', donationId);
      if (donation.project_id) {
        db.prepare('UPDATE projects SET amount_raised = amount_raised + ? WHERE id = ?')
          .run(Number(donation.amount_project || 0), donation.project_id);
      }
    }
  }

  res.json({ received: true });
});

app.get('/admin/donations', authRequired, adminRequired, (req, res) => {
  const items = db.prepare('SELECT * FROM donations ORDER BY created_at DESC').all();
  res.json({ items });
});

app.listen(PORT, () => {
  console.log(`ChristHelper backend running on http://localhost:${PORT}`);
  console.log('Demo admin:', 'admin@christhelper.local / admin123');
});
