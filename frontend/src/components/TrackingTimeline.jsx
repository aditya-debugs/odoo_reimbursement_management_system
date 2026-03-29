import { useEffect, useState, useCallback } from 'react';
import { trackingApi } from '../api';
import './TrackingTimeline.css';

// ─── Icons ───────────────────────────────────────────────────────────────────
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);
const SkipIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const AlertIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDate(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(hours) {
  if (hours < 1) return 'Less than 1 hour';
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function StepDot({ status, isActive }) {
  return (
    <div className={`tt-dot tt-dot--${status}${isActive ? ' tt-dot--pulse' : ''}`}>
      {status === 'completed' && <CheckIcon />}
      {status === 'rejected' && <XIcon />}
      {status === 'pending' && <ClockIcon />}
      {status === 'skipped' && <SkipIcon />}
      {status === 'cancelled' && <XIcon />}
    </div>
  );
}

function StepConnector({ status, isLast }) {
  if (isLast) return null;
  return <div className={`tt-connector tt-connector--${status}`} />;
}

function StatusChip({ status, label }) {
  const map = {
    completed: { cls: 'chip-green', text: label || 'Approved' },
    rejected:  { cls: 'chip-red',   text: 'Rejected' },
    pending:   { cls: 'chip-amber', text: 'Pending' },
    skipped:   { cls: 'chip-gray',  text: 'Skipped' },
    cancelled: { cls: 'chip-gray',  text: 'Cancelled' },
  };
  const m = map[status] || map.pending;
  return <span className={`tt-chip ${m.cls}`}>{m.text}</span>;
}

function DelayBadge({ hours }) {
  return (
    <span className="tt-delay-badge">
      <AlertIcon />
      Delayed · {formatDuration(hours)}
    </span>
  );
}

function ETACard({ eta, currentLabel, avgDays }) {
  if (!eta) return null;
  const { minDays, maxDays } = eta;
  const pct = minDays === 0 ? 100 : Math.min(100, Math.round((1 - minDays / (maxDays || 1)) * 50));

  return (
    <div className="tt-eta-card">
      <div className="tt-eta-top">
        <div className="tt-eta-icon">⏱</div>
        <div>
          <div className="tt-eta-label">Estimated Reimbursement</div>
          <div className="tt-eta-value">
            {minDays === maxDays
              ? `${minDays} working day${minDays !== 1 ? 's' : ''}`
              : `${minDays}–${maxDays} working days`}
          </div>
        </div>
      </div>
      <div className="tt-eta-meta">
        <span className="tt-current-label">{currentLabel}</span>
        {avgDays != null && (
          <span className="tt-avg-label">Avg: {avgDays} days company-wide</span>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ percent }) {
  return (
    <div className="tt-progress-wrap">
      <div className="tt-progress-header">
        <span className="tt-progress-title">Approval Progress</span>
        <span className="tt-progress-pct">{percent}%</span>
      </div>
      <div className="tt-progress-track">
        <div
          className="tt-progress-fill"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function HistoryLog({ log }) {
  const [open, setOpen] = useState(false);
  if (!log || log.length === 0) return null;
  return (
    <div className="tt-history">
      <button className="tt-history-toggle" onClick={() => setOpen((o) => !o)}>
        📋 Audit History ({log.length} event{log.length !== 1 ? 's' : ''})
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="tt-history-list">
          {log.map((entry, i) => (
            <li key={i} className={`tt-history-item tt-history--${entry.action}`}>
              <div className="tt-history-dot" />
              <div className="tt-history-body">
                <div className="tt-history-actor">
                  <strong>{entry.actor}</strong>
                  <span className="tt-history-role">({entry.actor_role})</span>
                  <span className={`tt-chip chip-sm ${entry.action === 'approved' ? 'chip-green' : entry.action === 'rejected' ? 'chip-red' : 'chip-gray'}`}>
                    {entry.action}
                  </span>
                </div>
                <div className="tt-history-stage">{entry.stage}</div>
                {entry.comments && (
                  <div className="tt-history-comment">"{entry.comments}"</div>
                )}
                <time className="tt-history-time">{formatDate(entry.timestamp)}</time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TrackingTimeline({ expenseId, onResubmit }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: d } = await trackingApi.get(expenseId);
      setData(d);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load tracking');
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => {
    load();
    // Auto-refresh every 30 seconds for real-time feel
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="tt-loading">
        <div className="tt-spinner" />
        <span>Loading tracking data…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tt-error">
        <AlertIcon />
        <span>{error}</span>
        <button className="btn btn-secondary btn-sm" onClick={load}>Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const { timeline, progress, eta, current_stage_label, history_log, avg_processing_days, has_delay, expense } = data;
  const isRejected = expense.status === 'rejected';
  const isApproved = expense.status === 'approved';
  const isCancelled = expense.status === 'cancelled';

  return (
    <div className="tt-root">
      {/* Header */}
      <div className="tt-header">
        <div className="tt-header-left">
          <h2 className="tt-title">Approval Journey</h2>
          <span className="tt-refresh-time">Updated {formatDate(lastRefresh)}</span>
        </div>
        <button
          className="tt-refresh-btn"
          onClick={load}
          disabled={loading}
          title="Refresh"
        >
          <span className={loading ? 'tt-spinning' : ''}><RefreshIcon /></span>
          Refresh
        </button>
      </div>

      {/* Delay warning */}
      {has_delay && (
        <div className="tt-delay-banner">
          <AlertIcon />
          This expense has pending stages that are taking longer than expected.
        </div>
      )}

      {/* Status banner */}
      {(isApproved || isRejected || isCancelled) && (
        <div className={`tt-outcome-banner tt-outcome--${expense.status}`}>
          {isApproved && '✅ Your expense has been fully approved and will be reimbursed soon.'}
          {isRejected && '❌ Your expense was rejected. Please review the comments below.'}
          {isCancelled && '🚫 This expense was cancelled.'}
        </div>
      )}

      {/* ETA Card */}
      {eta && (
        <ETACard
          eta={eta}
          currentLabel={current_stage_label}
          avgDays={avg_processing_days}
        />
      )}

      {/* Progress Bar */}
      <ProgressBar percent={progress.percent} />

      {/* Timeline */}
      <div className="tt-timeline">
        {timeline.map((step, idx) => {
          const isLast = idx === timeline.length - 1;
          const prevStatus = idx > 0 ? timeline[idx - 1].status : null;
          const isPrevCompleted = prevStatus === 'completed';

          return (
            <div key={step.id} className={`tt-step${step.is_active ? ' tt-step--active' : ''}`}>
              {/* Left column: dot + connector */}
              <div className="tt-step-left">
                <StepDot status={step.status} isActive={step.is_active} />
                <StepConnector status={isPrevCompleted ? 'done' : 'idle'} isLast={isLast} />
              </div>

              {/* Right column: content */}
              <div className="tt-step-content">
                <div className="tt-step-top">
                  <div className="tt-step-name">{step.stage_name}</div>
                  <StatusChip status={step.status} label={step.status === 'completed' ? 'Approved' : null} />
                  {step.is_delayed && <DelayBadge hours={step.delay_hours} />}
                </div>

                {step.approver_name && (
                  <div className="tt-step-approver">
                    <div className="tt-avatar">{step.approver_name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div className="tt-approver-name">{step.approver_name}</div>
                      {step.approver_role && (
                        <div className="tt-approver-role">{step.approver_role}</div>
                      )}
                    </div>
                  </div>
                )}

                {step.comments && (
                  <div className="tt-step-comment">
                    <span className="tt-comment-icon">💬</span>
                    "{step.comments}"
                  </div>
                )}

                {step.action_at && (
                  <time className="tt-step-time">{formatDate(step.action_at)}</time>
                )}

                {step.is_active && step.stage_config && (
                  <div className="tt-step-eta-hint">
                    Expected in {step.stage_config.min_days}–{step.stage_config.max_days} day{step.stage_config.max_days !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Resubmit if rejected */}
      {isRejected && onResubmit && (
        <div className="tt-resubmit">
          <p className="tt-resubmit-hint">
            You can edit and resubmit this expense after addressing the rejection reason.
          </p>
          <button className="btn btn-primary" onClick={onResubmit}>
            Resubmit Expense
          </button>
        </div>
      )}

      {/* History Log */}
      <HistoryLog log={history_log} />
    </div>
  );
}
