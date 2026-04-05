require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5500';
const CURRENCY = (process.env.STRIPE_CURRENCY || 'nzd').toLowerCase();
const DATA_FILE = path.resolve(__dirname, process.env.DATA_FILE || './data.json');
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.use(cors());
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

function readDb() {
  if (!fs.existsSync(DATA_FILE)) {
    const seeded = createSeedData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(seeded, null, 2));
    return seeded;
  }

  const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
  if (!raw) {
    const seeded = createSeedData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(seeded, null, 2));
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
    db.meta = { version: 1, created_at: now() };
    changed = true;
  }

  if (!db.users.find((u) => u.email === 'admin@christhelper.local')) {
    db.users.push({
      id: createId(),
      name: 'ChristHelper Admin',
      email: 'admin@christhelper.local',
      password_hash: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      created_at: now()
    });
    changed = true;
  }

  if (changed) writeDb(db);
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function withDb(action) {
  const db = readDb();
  const result = action(db);
  writeDb(db);
  return result;
}

function createSeedData() {
  const adminId = createId();
  const project1 = createId();
  const project2 = createId();
  const project3 = createId();

  return {
    meta: {
      version: 1,
      created_at: now()
    },
    users: [
      {
        id: adminId,
        name: 'ChristHelper Admin',
        email: 'admin@christhelper.local',
        password_hash: bcrypt.hashSync('admin123', 10),
        role: 'admin',
        created_at: now()
      }
    ],
    projects: [
      {
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
        funding_approved: true,
        amount_raised: 350,
        admin_reviewed: true,
        verified_ministry: true,
        status: 'active',
        timeline: 'May 2026',
        who_benefits: 'Teenagers and young adults in the community',
        why_it_matters: 'Many youth are disconnected from church and need hope, mentoring, and community.',
        created_by: adminId,
        created_at: now()
      },
      {
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
        funding_approved: true,
        amount_raised: 900,
        admin_reviewed: true,
        verified_ministry: false,
        status: 'active',
        timeline: 'June 2026',
        who_benefits: 'Families in remote river communities',
        why_it_matters: 'Access to Scripture is limited and many families have requested Bibles and study material.',
        created_by: adminId,
        created_at: now()
      },
      {
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
        funding_approved: false,
        amount_raised: 0,
        admin_reviewed: true,
        verified_ministry: false,
        status: 'active',
        timeline: 'Ongoing',
        who_benefits: 'Online readers and small groups',
        why_it_matters: 'Many people need accessible digital discipleship resources.',
        created_by: adminId,
        created_at: now()
      }
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
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
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

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'christhelper-backend-node24-safe', time: now(), data_file: DATA_FILE });
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

    const user = {
      id: createId(),
      name: String(name).trim(),
      email: normalizedEmail,
      password_hash: bcrypt.hashSync(String(password), 10),
      role: 'supporter',
      created_at: now()
    };

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

  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const payload = publicUser(user);
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: payload });
});

app.get('/projects', (req, res) => {
  const { country, continent, helpType, category, q, financialOnly, reviewedOnly, verifiedOnly, urgency } = req.query;
  const db = readDb();
  let items = db.projects.filter((project) => project.status === 'active');

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
      project.category
    ].some((value) => String(value || '').toLowerCase().includes(term)));
  }

  items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ items: clone(items) });
});

app.get('/projects/:id', (req, res) => {
  const db = readDb();
  const project = db.projects.find((item) => item.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const prayers = db.prayers.filter((item) => item.project_id === req.params.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 20);
  const replies = db.replies.filter((item) => item.project_id === req.params.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 20);
  const updates = db.updates.filter((item) => item.project_id === req.params.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 20);

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
  const required = ['title', 'summary', 'description', 'country', 'continent', 'category', 'requester_name', 'contact_email'];
  for (const field of required) {
    if (!body[field]) return res.status(400).json({ error: `${field} is required` });
  }

  const helpTypes = Array.isArray(body.help_types) ? body.help_types : [];
  const needsFinancialSupport = Boolean(body.needs_financial_support);

  const projectId = withDb((db) => {
    const project = {
      id: createId(),
      title: String(body.title),
      summary: String(body.summary),
      description: String(body.description),
      country: String(body.country),
      continent: String(body.continent),
      city: String(body.city || ''),
      category: String(body.category),
      help_types: helpTypes,
      requester_name: String(body.requester_name),
      organization_name: String(body.organization_name || ''),
      church_ministry_linked: String(body.church_ministry_linked || ''),
      contact_email: String(body.contact_email),
      urgency: String(body.urgency || 'normal'),
      is_online: Boolean(body.is_online),
      needs_financial_support: needsFinancialSupport,
      funding_goal: Number(body.funding_goal || 0),
      funding_approved: false,
      amount_raised: 0,
      admin_reviewed: false,
      verified_ministry: false,
      status: 'active',
      timeline: String(body.timeline || ''),
      who_benefits: String(body.who_benefits || ''),
      why_it_matters: String(body.why_it_matters || ''),
      created_by: req.user.id,
      created_at: now()
    };

    db.projects.push(project);
    db.updates.push({
      id: createId(),
      project_id: project.id,
      title: 'Project submitted',
      content: needsFinancialSupport
        ? 'This project has been submitted and is waiting for admin review for financial support.'
        : 'This project has been submitted successfully.',
      created_at: now()
    });

    return project.id;
  });

  res.status(201).json({ id: projectId, message: 'Project created successfully' });
});

app.post('/projects/:id/pray', (req, res) => {
  const { name, message } = req.body || {};
  const result = withDb((db) => {
    const project = db.projects.find((item) => item.id === req.params.id);
    if (!project) return false;
    db.prayers.push({
      id: createId(),
      project_id: req.params.id,
      name: name || 'Anonymous',
      message: message || 'Prayed for this project.',
      created_at: now()
    });
    return true;
  });

  if (!result) return res.status(404).json({ error: 'Project not found' });
  res.json({ message: 'Prayer support recorded' });
});

app.post('/projects/:id/reply', (req, res) => {
  const { type, name, email, message } = req.body || {};
  if (!type || !name || !message) {
    return res.status(400).json({ error: 'Type, name and message are required' });
  }

  const result = withDb((db) => {
    const project = db.projects.find((item) => item.id === req.params.id);
    if (!project) return false;
    db.replies.push({
      id: createId(),
      project_id: req.params.id,
      type,
      name,
      email: email || '',
      message,
      created_at: now()
    });
    return true;
  });

  if (!result) return res.status(404).json({ error: 'Project not found' });
  res.json({ message: 'Support offer sent' });
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
  const { funding_approved, admin_reviewed, verified_ministry, status } = req.body || {};

  const updated = withDb((db) => {
    const project = db.projects.find((item) => item.id === req.params.id);
    if (!project) return null;

    if (funding_approved !== undefined) project.funding_approved = Boolean(funding_approved);
    if (admin_reviewed !== undefined) project.admin_reviewed = Boolean(admin_reviewed);
    if (verified_ministry !== undefined) project.verified_ministry = Boolean(verified_ministry);
    if (status !== undefined) project.status = String(status);

    return clone(project);
  });

  if (!updated) return res.status(404).json({ error: 'Project not found' });
  res.json({ message: 'Project updated', project: updated });
});

app.post('/payments/project-checkout', async (req, res) => {
  try {
    const { project_id, donor_name, donor_email, amount_project, amount_platform } = req.body || {};
    const db = readDb();
    const project = db.projects.find((item) => item.id === project_id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.funding_approved) return res.status(400).json({ error: 'Financial support is not enabled for this project yet' });

    const projectAmount = Number(amount_project || 0);
    const platformAmount = Number(amount_platform || 0);
    if (projectAmount <= 0 && platformAmount <= 0) {
      return res.status(400).json({ error: 'Enter a valid donation amount' });
    }

    const donation = withDb((state) => {
      const record = {
        id: createId(),
        project_id,
        donor_name: donor_name || 'Anonymous',
        donor_email: donor_email || '',
        amount_project: projectAmount,
        amount_platform: platformAmount,
        currency: CURRENCY,
        stripe_session_id: '',
        payment_status: 'pending',
        donation_type: 'project',
        created_at: now()
      };
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
        donation_id: donation.id,
        project_id: project_id
      }
    });

    withDb((state) => {
      const target = state.donations.find((item) => item.id === donation.id);
      if (target) target.stripe_session_id = session.id;
    });

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

    const donation = withDb((state) => {
      const record = {
        id: createId(),
        project_id: null,
        donor_name: donor_name || 'Anonymous',
        donor_email: donor_email || '',
        amount_project: 0,
        amount_platform: platformAmount,
        currency: CURRENCY,
        stripe_session_id: '',
        payment_status: 'pending',
        donation_type: 'platform',
        created_at: now()
      };
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
      success_url: `${FRONTEND_URL}/success.html?type=platform`,
      cancel_url: `${FRONTEND_URL}/help-christhelper.html`,
      customer_email: donor_email || undefined,
      metadata: { donation_id: donation.id, donation_type: 'platform' }
    });

    withDb((state) => {
      const target = state.donations.find((item) => item.id === donation.id);
      if (target) target.stripe_session_id = session.id;
    });

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
    const donationId = session.metadata?.donation_id;
    withDb((db) => {
      const donation = db.donations.find((item) => item.id === donationId);
      if (!donation) return;
      donation.payment_status = 'paid';
      if (donation.project_id) {
        const project = db.projects.find((item) => item.id === donation.project_id);
        if (project) {
          project.amount_raised = Number(project.amount_raised || 0) + Number(donation.amount_project || 0);
        }
      }
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
  console.log(`Data file: ${DATA_FILE}`);
  console.log('Demo admin: admin@christhelper.local / admin123');
});
