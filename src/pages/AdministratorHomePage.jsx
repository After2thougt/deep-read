
import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminOverview,
  fetchAdminUsers,
} from "../api/adminUsers";import { getAccountDistribution } from "../utils/adminOverview";

const STAT_CARDS = [
  {
    key: "totalUsers",
    label: "Total users",
    description: "All registered accounts",
    icon: "users",
    tone: "blue",
  },
  {
    key: "activeUsers",
    label: "Active users",
    description: "Currently enabled accounts",
    icon: "activity",
    tone: "green",
  },
  {
    key: "disabledUsers",
    label: "Disabled users",
    description: "Accounts with access disabled",
    icon: "user-x",
    tone: "amber",
  },
  {
  key: "guestUsers",
  label: "Guest users",
  description: "Guest accounts",
  icon: "users",
  tone: "violet",
},
];

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatRegistrationDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getInitials(username) {
  const value = String(username || "?").trim();
  return value.slice(0, 2).toUpperCase();
}

function StatIcon({ type }) {
  const paths = {
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="10" cy="7" r="4" />
        <path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    activity: (
      <>
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </>
    ),
    "user-x": (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="10" cy="7" r="4" />
        <path d="m17 8 5 5m0-5-5 5" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  };

  return (
    <svg
      className="administrator-home__stat-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[type]}
    </svg>
  );
}

function LoadingSkeleton() {
  return (
    <div className="administrator-home__content" aria-label="Loading overview">
      <div className="administrator-home__stats">
        {STAT_CARDS.map((card) => (
          <div className="administrator-home__skeleton-card" key={card.key}>
            <span className="administrator-home__skeleton administrator-home__skeleton--label" />
            <span className="administrator-home__skeleton administrator-home__skeleton--number" />
            <span className="administrator-home__skeleton administrator-home__skeleton--description" />
          </div>
        ))}
      </div>
      <div className="administrator-home__sections">
        <div className="administrator-home__skeleton-panel" />
        <div className="administrator-home__skeleton-panel" />
      </div>
    </div>
  );
}

export default function AdministratorHomePage() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const loadOverview = useCallback(async (signal) => {
    setLoading(true);
    setError("");

    try {
      const [result, users] = await Promise.all([
  fetchAdminOverview(),
  fetchAdminUsers(),
]);

if (!signal.cancelled) {
  const guestUsers = users.filter(
    (user) => user.role === "guest"
  ).length;

  setOverview({
    ...result,
    stats: {
      ...result.stats,
      guestUsers,
    },
  });
}
    } catch (requestError) {
      if (!signal.cancelled) {
        setError(
          requestError.message || "Unable to load platform overview."
        );
      }
    } finally {
      if (!signal.cancelled) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    loadOverview(signal);

    return () => {
      signal.cancelled = true;
    };
  }, [loadOverview, reloadKey]);

  const stats = overview?.stats;
  const distribution = stats ? getAccountDistribution(stats) : null;
  const recentUsers = overview?.recentUsers || [];

  const activePercent = distribution
    ? Math.max(0, Math.min(100, distribution.activePercent || 0))
    : 0;
  const disabledPercent = distribution
    ? Math.max(0, Math.min(100, distribution.disabledPercent || 0))
    : 0;

  const donutStyle = {
    "--active-percent": `${activePercent}%`,
    "--disabled-percent": `${activePercent + disabledPercent}%`,
  };

  return (
    <main className="administrator-home">
      <header className="administrator-home__header">
        <div>
          <span className="administrator-home__eyebrow">
            ADMINISTRATION
          </span>
          <h1>Overview</h1>
          <p>A snapshot of your platform and its users.</p>
        </div>

        <button
          className="administrator-home__refresh"
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={loading}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 7v5h-5M4 17v-5h5" />
            <path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" />
          </svg>
          Refresh
        </button>
      </header>

      {error && (
        <div className="administrator-home__error" role="alert">
          <div>
            <strong>Something went wrong</strong>
            <p>{error}</p>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {loading && !overview ? (
        <LoadingSkeleton />
      ) : stats ? (
        <div className="administrator-home__content">
          <section
            className="administrator-home__stats"
            aria-label="User statistics"
          >
            {STAT_CARDS.map(({ key, label, description, icon, tone }) => (
              <article
                className="administrator-home__stat"
                key={key}
              >
                <div className="administrator-home__stat-top">
                  <span className="administrator-home__stat-label">
                    {label}
                  </span>
                  <span
                    className={`administrator-home__stat-icon-wrap administrator-home__stat-icon-wrap--${tone}`}
                  >
                    <StatIcon type={icon} />
                  </span>
                </div>
                <p className="administrator-home__stat-value">
                  {formatNumber(stats[key])}
                </p>
                <span className="administrator-home__stat-description">
                  {description}
                </span>
              </article>
            ))}
          </section>

          <div className="administrator-home__sections">
            <section
              className="administrator-home__panel administrator-home__distribution"
              aria-labelledby="account-distribution-title"
            >
              <header className="administrator-home__panel-header">
                <div>
                  <h2 id="account-distribution-title">
                    Account distribution
                  </h2>
                  <p>Breakdown by account status</p>
                </div>
              </header>

              <div className="administrator-home__distribution-content">
                <div
                  className={`administrator-home__donut ${
                    stats.totalUsers === 0
                      ? "administrator-home__donut--empty"
                      : ""
                  }`}
                  style={donutStyle}
                  role="img"
                  aria-label={`Active users: ${formatNumber(
                    stats.activeUsers
                  )}; disabled users: ${formatNumber(
                    stats.disabledUsers
                  )}`}
                >
                  <div className="administrator-home__donut-center">
                    <strong>{formatNumber(stats.totalUsers)}</strong>
                    <span>Total users</span>
                  </div>
                </div>

                <ul className="administrator-home__legend">
                  <li>
                    <div className="administrator-home__legend-info">
                      <span className="administrator-home__legend-dot administrator-home__legend-dot--active" />
                      <span>Active users</span>
                    </div>
                    <div className="administrator-home__legend-values">
                      <strong>{formatNumber(stats.activeUsers)}</strong>
                      <span>{Math.round(activePercent)}%</span>
                    </div>
                  </li>
                  <li>
                    <div className="administrator-home__legend-info">
                      <span className="administrator-home__legend-dot administrator-home__legend-dot--disabled" />
                      <span>Disabled users</span>
                    </div>
                    <div className="administrator-home__legend-values">
                      <strong>{formatNumber(stats.disabledUsers)}</strong>
                      <span>{Math.round(disabledPercent)}%</span>
                    </div>
                  </li>
                </ul>
              </div>
            </section>

            <section
              className="administrator-home__panel administrator-home__recent"
              aria-labelledby="recent-users-title"
            >
              <header className="administrator-home__panel-header">
                <div>
                  <h2 id="recent-users-title">Recently registered</h2>
                  <p>Latest regular user accounts</p>
                </div>
                <span className="administrator-home__count">
                  {recentUsers.length}
                </span>
              </header>

              {recentUsers.length === 0 ? (
                <div className="administrator-home__empty">
                  <span className="administrator-home__empty-icon">
                    <StatIcon type="users" />
                  </span>
                  <strong>No registrations yet</strong>
                  <p>New user accounts will appear here.</p>
                </div>
              ) : (
                <ul className="administrator-home__recent-users">
                  {recentUsers.map((user) => (
                    <li key={user.username}>
                      <div className="administrator-home__user">
                        <span className="administrator-home__avatar">
                          {getInitials(user.username)}
                        </span>
                        <span className="administrator-home__username">
                          {user.username}
                        </span>
                      </div>
                      <time
                        dateTime={user.createdAt || undefined}
                        title={user.createdAt || undefined}
                      >
                        {formatRegistrationDate(user.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      ) : !loading && !error ? (
        <div className="administrator-home__empty-state">
          <strong>No overview data available</strong>
          <p>The platform overview returned no data.</p>
        </div>
      ) : null}
    </main>
  );
}
