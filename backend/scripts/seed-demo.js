/**
 * Rich demo tenant for Neon/Postgres: Northwind Industries (Demo).
 * Large dataset for analytics (multi-month approved spend), many users/roles,
 * categories, approval rules (1 active + several inactive with steps), budgets, notifications, audit.
 *
 *   cd backend && npm run seed:demo
 *   npm run seed:demo -- --reset
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { appendAuditBlock } = require('../services/audit.service');

const COMPANY_NAME = 'Northwind Industries (Demo)';
const DEMO_PASSWORD = 'Demo123!';
const RESET = process.argv.includes('--reset');

const uid = () => crypto.randomUUID();

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const client = await pool.connect();

  try {
    if (RESET) {
      const del = await client.query(`DELETE FROM companies WHERE name = $1 RETURNING id`, [COMPANY_NAME]);
      console.log(del.rowCount ? `Removed previous "${COMPANY_NAME}".` : 'No previous demo company.');
    } else {
      const ex = await client.query(`SELECT id FROM companies WHERE name = $1`, [COMPANY_NAME]);
      if (ex.rows.length) {
        console.error(`Demo exists. Use --reset or log in with demo emails / ${DEMO_PASSWORD}`);
        process.exit(1);
      }
    }

    await client.query('BEGIN');

    const companyId = uid();
    await client.query(
      `INSERT INTO companies (id, name, country, currency_code, currency_symbol)
       VALUES ($1, $2, 'India', 'INR', '₹')`,
      [companyId, COMPANY_NAME]
    );

    const U = {
      admin: uid(),
      director: uid(),
      financer: uid(),
      financer2: uid(),
      mgrRiya: uid(),
      mgrKaran: uid(),
      mgrDeepa: uid(),
      neha: uid(),
      siddharth: uid(),
      aditi: uid(),
      dev: uid(),
      tara: uid(),
      arjun: uid(),
      meera: uid(),
      kavita: uid(),
      omar: uid(),
    };

    const users = [
      [U.admin, 'Priya Nair', 'admin@northwind-demo.local', 'admin', null, true],
      [U.director, 'Vikram Desai', 'director@northwind-demo.local', 'director', null, false],
      [U.financer, 'Ananya Krishnan', 'financer@northwind-demo.local', 'financer', null, false],
      [U.financer2, 'Rahul Varma', 'financer2@northwind-demo.local', 'financer', null, false],
      [U.mgrRiya, 'Riya Malhotra', 'manager.riya@northwind-demo.local', 'manager', U.director, true],
      [U.mgrKaran, 'Karan Bedi', 'manager.karan@northwind-demo.local', 'manager', U.director, true],
      [U.mgrDeepa, 'Deepa Srinivasan', 'manager.deepa@northwind-demo.local', 'manager', U.director, true],
      [U.neha, 'Neha Joshi', 'neha.emp@northwind-demo.local', 'employee', U.mgrRiya, false],
      [U.siddharth, 'Siddharth Iyer', 'siddharth.emp@northwind-demo.local', 'employee', U.mgrRiya, false],
      [U.aditi, 'Aditi Menon', 'aditi.emp@northwind-demo.local', 'employee', U.mgrKaran, false],
      [U.dev, 'Dev Patel', 'dev.emp@northwind-demo.local', 'employee', U.mgrKaran, false],
      [U.tara, 'Tara Singh', 'tara.emp@northwind-demo.local', 'employee', U.mgrRiya, false],
      [U.arjun, 'Arjun Khanna', 'arjun.emp@northwind-demo.local', 'employee', U.mgrKaran, false],
      [U.meera, 'Meera Nambiar', 'meera.emp@northwind-demo.local', 'employee', U.mgrKaran, false],
      [U.kavita, 'Kavita Reddy', 'kavita.emp@northwind-demo.local', 'employee', U.mgrDeepa, false],
      [U.omar, 'Omar Hossain', 'omar.emp@northwind-demo.local', 'employee', U.mgrDeepa, false],
    ];

    for (const [id, name, email, role, manager_id, is_mgr_app] of users) {
      await client.query(
        `INSERT INTO users (id, company_id, name, email, password_hash, role, manager_id, is_manager_approver)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, companyId, name, email, passwordHash, role, manager_id, is_mgr_app]
      );
    }

    const catIds = {
      travel: uid(),
      meals: uid(),
      software: uid(),
      client: uid(),
      office: uid(),
      training: uid(),
      fuel: uid(),
      telecom: uid(),
      medical: uid(),
      marketing: uid(),
      vehicles: uid(),
    };

    const categories = [
      [catIds.travel, 'Travel', 'Flights, trains, hotels', true, 5],
      [catIds.meals, 'Meals & entertainment', 'Team and client meals', true, 5],
      [catIds.software, 'Software & SaaS', 'Licenses and cloud', true, 18],
      [catIds.client, 'Client hospitality', 'Events and gifts', false, 18],
      [catIds.office, 'Office supplies', 'Equipment and stationery', true, 18],
      [catIds.training, 'Training & conferences', 'Courses and passes', false, 18],
      [catIds.fuel, 'Fuel & mileage', 'Local transport reimbursement', true, 5],
      [catIds.telecom, 'Telecom & internet', 'Mobile and broadband', true, 18],
      [catIds.medical, 'Medical (OOP)', 'Reimbursable medical', false, 18],
      [catIds.marketing, 'Marketing & brand', 'Campaigns, creatives', true, 18],
      [catIds.vehicles, 'Fleet & repairs', 'Vehicle maintenance', true, 18],
    ];

    for (const [id, name, desc, gst, rate] of categories) {
      await client.query(
        `INSERT INTO expense_categories (id, company_id, name, description, is_active, gst_applicable, gst_rate_percent)
         VALUES ($1,$2,$3,$4,true,$5,$6)`,
        [id, companyId, name, desc, gst, rate]
      );
    }

    /* Active rule first (oldest active wins in app) */
    const ruleSeqId = uid();
    await client.query(
      `INSERT INTO approval_rules (id, company_id, name, description, rule_type, percentage_threshold, specific_approver_id, is_active, sequential_conditional_override)
       VALUES ($1,$2,'Standard chain','Manager review → Finance → Director sign-off','sequential',NULL,NULL,true,false)`,
      [ruleSeqId, companyId]
    );

    const s1 = uid();
    const s2 = uid();
    const s3 = uid();
    await client.query(
      `INSERT INTO approval_rule_steps (id, rule_id, approver_id, step_order) VALUES
       ($1,$4,$5,1), ($2,$4,$6,2), ($3,$4,$7,3)`,
      [s1, s2, s3, ruleSeqId, U.mgrRiya, U.financer, U.director]
    );

    const rulePctId = uid();
    await client.query(
      `INSERT INTO approval_rules (id, company_id, name, description, rule_type, percentage_threshold, is_active, sequential_conditional_override)
       VALUES ($1,$2,'Finance council (inactive)','Parallel: 67% of listed approvers','percentage',67,false,false)`,
      [rulePctId, companyId]
    );
    const ps1 = uid();
    const ps2 = uid();
    const ps3 = uid();
    await client.query(
      `INSERT INTO approval_rule_steps (id, rule_id, approver_id, step_order) VALUES ($1,$4,$5,1), ($2,$4,$6,2), ($3,$4,$7,3)`,
      [ps1, ps2, ps3, rulePctId, U.financer, U.financer2, U.director]
    );

    const ruleSpecId = uid();
    await client.query(
      `INSERT INTO approval_rules (id, company_id, name, description, rule_type, percentage_threshold, specific_approver_id, is_active, sequential_conditional_override)
       VALUES ($1,$2,'Director-only override (inactive)','If director approves, closes','specific_approver',NULL,$3,false,false)`,
      [ruleSpecId, companyId, U.director]
    );
    const ss1 = uid();
    const ss2 = uid();
    await client.query(
      `INSERT INTO approval_rule_steps (id, rule_id, approver_id, step_order) VALUES ($1,$3,$4,1), ($2,$3,$5,2)`,
      [ss1, ss2, ruleSpecId, U.mgrKaran, U.financer]
    );

    const ruleHybId = uid();
    await client.query(
      `INSERT INTO approval_rules (id, company_id, name, description, rule_type, percentage_threshold, specific_approver_id, is_active, sequential_conditional_override)
       VALUES ($1,$2,'Hybrid pilot (inactive)','50% OR director shortcut','hybrid',50,$3,false,false)`,
      [ruleHybId, companyId, U.director]
    );
    const hs1 = uid();
    const hs2 = uid();
    const hs3 = uid();
    await client.query(
      `INSERT INTO approval_rule_steps (id, rule_id, approver_id, step_order) VALUES ($1,$4,$5,1), ($2,$4,$6,2), ($3,$4,$7,3)`,
      [hs1, hs2, hs3, ruleHybId, U.mgrDeepa, U.financer, U.director]
    );

    const snapSteps = [
      { approver_id: U.mgrRiya, rule_step_id: s1, step_order: 1, is_manager_step: false },
      { approver_id: U.financer, rule_step_id: s2, step_order: 2, is_manager_step: false },
      { approver_id: U.director, rule_step_id: s3, step_order: 3, is_manager_step: false },
    ];

    const budgetRows = [
      [catIds.travel, 180000],
      [catIds.meals, 95000],
      [catIds.software, 200000],
      [catIds.office, 65000],
      [catIds.training, 120000],
      [catIds.marketing, 150000],
    ];
    for (const [cid, cap] of budgetRows) {
      await client.query(
        `INSERT INTO category_budgets (id, company_id, category_id, monthly_cap) VALUES ($1,$2,$3,$4)`,
        [uid(), companyId, cid, cap]
      );
    }

    async function addExpense({
      id,
      employee_id,
      category_id,
      title,
      description,
      amount,
      expense_date,
      status,
      current_approver_sequence,
      fraud_flags,
      fraud_score,
      fraud_level,
      approvalRows,
    }) {
      const amt = parseFloat(amount);
      await client.query(
        `INSERT INTO expenses (
          id, employee_id, company_id, category_id, title, description, amount, currency_code,
          amount_in_company_currency, exchange_rate, conversion_at, expense_date, status,
          fraud_flags, fraud_score, fraud_level, fraud_summary, current_approver_sequence
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,'INR',$7,1,NOW(),$8::date,$9,$10::jsonb,$11,$12,$13,$14
        )`,
        [
          id,
          employee_id,
          companyId,
          category_id,
          title,
          description,
          amt,
          expense_date,
          status,
          JSON.stringify(fraud_flags || []),
          fraud_score ?? null,
          fraud_level ?? null,
          fraud_level ? `Risk ${fraud_level}` : null,
          current_approver_sequence ?? 0,
        ]
      );

      if (approvalRows && approvalRows.length) {
        await client.query(
          `INSERT INTO expense_workflow_snapshots (
            id, expense_id, company_id, rule_id, rule_type, manager_prepended, sequential_conditional_override,
            percentage_threshold, specific_approver_id, steps
          ) VALUES ($1,$2,$3,$4,'sequential',false,false,NULL,NULL,$5::jsonb)`,
          [uid(), id, companyId, ruleSeqId, JSON.stringify(snapSteps)]
        );

        for (const row of approvalRows) {
          await client.query(
            `INSERT INTO expense_approvals (id, expense_id, approver_id, rule_step_id, sequence_order, is_manager_step, status, comments, action_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              uid(),
              id,
              row.approver_id,
              row.rule_step_id,
              row.sequence_order,
              false,
              row.status,
              row.comments || null,
              row.action_at || null,
            ]
          );
        }
      }
    }

    const approvedRow = (t1, t2, t3) => [
      { approver_id: U.mgrRiya, rule_step_id: s1, sequence_order: 1, status: 'approved', comments: 'OK', action_at: t1 },
      { approver_id: U.financer, rule_step_id: s2, sequence_order: 2, status: 'approved', comments: 'Checked', action_at: t2 },
      { approver_id: U.director, rule_step_id: s3, sequence_order: 3, status: 'approved', comments: 'Approved', action_at: t3 },
    ];

    const empPool = [U.neha, U.siddharth, U.aditi, U.dev, U.tara, U.arjun, U.meera, U.kavita, U.omar];
    const catPool = Object.values(catIds);
    const titles = [
      'Client visit — local conveyance',
      'Team lunch',
      'SaaS renewal (pro-rated)',
      'Conference ticket',
      'Printer supplies',
      'Fuel — field audit',
      'Mobile bill reimbursement',
      'Wellness checkup',
      'LinkedIn campaign',
      'Vehicle servicing',
      'Hotel — outstation',
      'Stand-up breakfast',
      'GitHub Copilot seats',
      'Partner dinner',
      'Whiteboard & markers',
    ];

    let gen = 0;
    const startWeek = new Date('2025-10-06T12:00:00.000Z');
    for (let w = 0; w < 22; w++) {
      const d = new Date(startWeek);
      d.setUTCDate(d.getUTCDate() + w * 7);
      const ds = isoDate(d);
      const eid = uid();
      const emp = empPool[gen % empPool.length];
      const cat = catPool[gen % catPool.length];
      const t1 = new Date(d);
      t1.setUTCDate(t1.getUTCDate() + 1);
      const t2 = new Date(d);
      t2.setUTCDate(t2.getUTCDate() + 2);
      const t3 = new Date(d);
      t3.setUTCDate(t3.getUTCDate() + 3);
      await addExpense({
        id: eid,
        employee_id: emp,
        category_id: cat,
        title: `${titles[gen % titles.length]} (${w + 1})`,
        description: 'Seeded for analytics dashboards.',
        amount: 1800 + (gen % 11) * 920 + (w % 5) * 210,
        expense_date: ds,
        status: 'approved',
        current_approver_sequence: 0,
        fraud_flags: [],
        approvalRows: approvedRow(t1, t2, t3),
      });
      gen++;
    }

    /* Extra approved lump sums for pie chart balance */
    const lumps = [
      [U.aditi, catIds.software, 'Microsoft 365 — annual', 156000, '2025-11-12'],
      [U.neha, catIds.travel, 'APAC sales trip — bundle', 98500, '2025-12-03'],
      [U.dev, catIds.training, 'Certification bootcamp', 62400, '2026-01-20'],
      [U.kavita, catIds.marketing, 'Trade show booth deposit', 78000, '2026-02-08'],
      [U.omar, catIds.vehicles, 'Fleet insurance Q1', 44200, '2026-02-26'],
    ];
    for (const [emp, cat, title, amt, ds] of lumps) {
      const d = new Date(`${ds}T12:00:00Z`);
      const t1 = new Date(d);
      t1.setUTCDate(t1.getUTCDate() + 1);
      const t2 = new Date(d);
      t2.setUTCDate(t2.getUTCDate() + 2);
      const t3 = new Date(d);
      t3.setUTCDate(t3.getUTCDate() + 3);
      await addExpense({
        id: uid(),
        employee_id: emp,
        category_id: cat,
        title,
        description: 'Seeded high-value line.',
        amount: amt,
        expense_date: ds,
        status: 'approved',
        current_approver_sequence: 0,
        fraud_flags: [],
        approvalRows: approvedRow(t1, t2, t3),
      });
    }

    const E = { p1: uid(), p2: uid(), p3: uid(), r1: uid(), r2: uid(), c1: uid(), c2: uid() };

    await addExpense({
      id: E.p1,
      employee_id: U.siddharth,
      category_id: catIds.meals,
      title: 'Client lunch — Acme Corp',
      description: 'Awaiting manager.',
      amount: 3200,
      expense_date: '2026-03-18',
      status: 'pending',
      current_approver_sequence: 1,
      fraud_flags: [],
      approvalRows: [
        { approver_id: U.mgrRiya, rule_step_id: s1, sequence_order: 1, status: 'pending', comments: null, action_at: null },
        { approver_id: U.financer, rule_step_id: s2, sequence_order: 2, status: 'skipped', comments: null, action_at: null },
        { approver_id: U.director, rule_step_id: s3, sequence_order: 3, status: 'skipped', comments: null, action_at: null },
      ],
    });

    await addExpense({
      id: E.p2,
      employee_id: U.aditi,
      category_id: catIds.travel,
      title: 'Delhi workshop — hotels',
      description: 'At finance review.',
      amount: 27350,
      expense_date: '2026-03-20',
      status: 'pending',
      current_approver_sequence: 2,
      fraud_flags: [],
      approvalRows: [
        { approver_id: U.mgrRiya, rule_step_id: s1, sequence_order: 1, status: 'approved', comments: 'Travel OK', action_at: new Date('2026-03-21T09:00:00Z') },
        { approver_id: U.financer, rule_step_id: s2, sequence_order: 2, status: 'pending', comments: null, action_at: null },
        { approver_id: U.director, rule_step_id: s3, sequence_order: 3, status: 'skipped', comments: null, action_at: null },
      ],
    });

    await addExpense({
      id: E.p3,
      employee_id: U.arjun,
      category_id: catIds.software,
      title: 'IDE licenses — Q2 top-up',
      description: 'Waiting on Riya.',
      amount: 18600,
      expense_date: '2026-03-25',
      status: 'pending',
      current_approver_sequence: 1,
      fraud_flags: [],
      approvalRows: [
        { approver_id: U.mgrRiya, rule_step_id: s1, sequence_order: 1, status: 'pending', comments: null, action_at: null },
        { approver_id: U.financer, rule_step_id: s2, sequence_order: 2, status: 'skipped', comments: null, action_at: null },
        { approver_id: U.director, rule_step_id: s3, sequence_order: 3, status: 'skipped', comments: null, action_at: null },
      ],
    });

    await addExpense({
      id: E.r1,
      employee_id: U.dev,
      category_id: catIds.meals,
      title: 'Friday team social',
      description: 'Over per-head cap.',
      amount: 9800,
      expense_date: '2026-03-12',
      status: 'rejected',
      current_approver_sequence: 1,
      fraud_flags: [{ type: 'UNUSUAL_AMOUNT', severity: 'medium', message: 'Higher than typical team meal.' }],
      fraud_score: 48,
      fraud_level: 'medium',
      approvalRows: [
        { approver_id: U.mgrRiya, rule_step_id: s1, sequence_order: 1, status: 'rejected', comments: 'Exceeds cap.', action_at: new Date('2026-03-13T11:00:00Z') },
        { approver_id: U.financer, rule_step_id: s2, sequence_order: 2, status: 'skipped', comments: null, action_at: null },
        { approver_id: U.director, rule_step_id: s3, sequence_order: 3, status: 'skipped', comments: null, action_at: null },
      ],
    });

    await addExpense({
      id: E.r2,
      employee_id: U.meera,
      category_id: catIds.client,
      title: 'Premium client gift baskets',
      description: 'Policy: gifts over ₹5k need pre-approval.',
      amount: 22000,
      expense_date: '2026-03-08',
      status: 'rejected',
      current_approver_sequence: 2,
      fraud_flags: [],
      approvalRows: [
        { approver_id: U.mgrRiya, rule_step_id: s1, sequence_order: 1, status: 'approved', comments: 'Should have pre-approved', action_at: new Date('2026-03-09T10:00:00Z') },
        { approver_id: U.financer, rule_step_id: s2, sequence_order: 2, status: 'rejected', comments: 'No pre-approval on file.', action_at: new Date('2026-03-10T14:00:00Z') },
        { approver_id: U.director, rule_step_id: s3, sequence_order: 3, status: 'skipped', comments: null, action_at: null },
      ],
    });

    await client.query(
      `INSERT INTO expenses (
        id, employee_id, company_id, category_id, title, description, amount, currency_code,
        amount_in_company_currency, exchange_rate, conversion_at, expense_date, status,
        fraud_flags, current_approver_sequence
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'INR',$7,1,NOW(),$8::date,'cancelled','[]'::jsonb,0)`,
      [E.c1, U.tara, companyId, catIds.software, 'Duplicate Cursor invoice', 'User withdrew.', 24000, '2026-03-10']
    );
    await client.query(
      `INSERT INTO expenses (
        id, employee_id, company_id, category_id, title, description, amount, currency_code,
        amount_in_company_currency, exchange_rate, conversion_at, expense_date, status,
        fraud_flags, current_approver_sequence
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'INR',$7,1,NOW(),$8::date,'cancelled','[]'::jsonb,0)`,
      [E.c2, U.kavita, companyId, catIds.marketing, 'Cancelled ad spend', 'Campaign paused.', 15000, '2026-03-15']
    );

    const notifs = [
      [U.mgrRiya, E.p1, 'Action required', 'Siddharth: Client lunch — Acme Corp'],
      [U.financer, E.p2, 'Action required', 'Aditi: Delhi workshop — hotels'],
      [U.mgrRiya, E.p3, 'Action required', 'Arjun: IDE licenses — Q2 top-up'],
      [U.admin, E.r1, 'Fraud / policy flags', 'Review Friday team social'],
      [U.neha, E.r1, 'Expense rejected', 'Your claim was rejected.'],
      [U.meera, E.r2, 'Expense rejected', 'Premium client gift baskets rejected.'],
      [U.director, null, 'Digest', 'Pending director sign-offs this week.'],
      [U.financer, null, 'Budget', 'Travel MTD approaching 70% of cap.'],
      [U.financer2, null, 'Reminder', 'Quarterly accrual review due.'],
      [U.mgrKaran, null, 'Policy', 'Updated per-diem PDF published.'],
      [U.mgrDeepa, E.p3, 'FYI', 'Software queue shared with finance.'],
      [U.admin, null, 'System', 'Demo dataset loaded — Northwind.'],
      [U.omar, null, 'Welcome', 'Your manager is Deepa Srinivasan.'],
      [U.kavita, null, 'Training', 'Submit receipts within 14 days.'],
    ];
    for (const [user_id, expense_id, title, message] of notifs) {
      await client.query(
        `INSERT INTO notifications (id, user_id, expense_id, title, message, is_read)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [uid(), user_id, expense_id, title, message, Math.random() > 0.4]
      );
    }

    await appendAuditBlock(client, {
      companyId,
      action: 'demo_seed_initialized',
      actorId: U.admin,
      expenseId: null,
      payload: { version: 2, company: COMPANY_NAME, expenses_seeded: gen + lumps.length + 7 },
    });
    await appendAuditBlock(client, {
      companyId,
      action: 'demo_bulk_import',
      actorId: U.admin,
      expenseId: null,
      payload: { rows: gen },
    });
    await appendAuditBlock(client, {
      companyId,
      action: 'demo_expense_rejected',
      actorId: U.mgrRiya,
      expenseId: E.r1,
      payload: { reason: 'per_head_cap' },
    });
    await appendAuditBlock(client, {
      companyId,
      action: 'demo_expense_rejected',
      actorId: U.financer,
      expenseId: E.r2,
      payload: { reason: 'pre_approval' },
    });

    await client.query('COMMIT');

    console.log('\n✅ Northwind demo data written to your database (Neon).');
    console.log('   Password for ALL demo users:', DEMO_PASSWORD);
    console.log('\n   Roles — log in to see role-specific sidebar:');
    console.log('   admin@northwind-demo.local (admin — full admin menu)');
    console.log('   director@northwind-demo.local | financer@northwind-demo.local | financer2@... (approvals + analytics + GST export)');
    console.log('   manager.riya@ | manager.karan@ | manager.deepa@ (approvals + analytics, no admin)');
    console.log('   *.emp@northwind-demo.local (employees — submit + my expenses only)');
    console.log('\n   Re-run: npm run seed:demo -- --reset\n');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', e.message);
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
