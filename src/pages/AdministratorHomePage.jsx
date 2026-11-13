import { useEffect, useState } from "react";
import { fetchAdminOverview } from "../api/adminUsers";
import { getAccountDistribution } from "../utils/adminOverview";

const STAT_CARDS = [
  { key: "totalUsers", label: "Total Users" },
  { key: "activeUsers", label: "Active Users" },
  { key: "disabledUsers", label: "Disabled Users" },
  { key: "administrators", label: "Administrators" },
];

function formatRegistrationDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdministratorHomePage() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetchAdminOverview()
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message || "Unable to load platform overview.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const distribution = overview ? getAccountDistribution(overview.stats) : null;

  return (
    <main className="administrator-home">
      <header className="administrator-home__header">
        <h2>Home</h2>
        <p>Platform overview</p>
      </header>

      {loading && <p className="administrator-home__status" role="status">Loading overview…</p>}
      {error && <p className="administrator-home__message" role="alert">{error}</p>}

      {overview && !error && (
        <>
          <section className="administrator-home__stats" aria-label="User statistics">
            {STAT_CARDS.map(({ key, label }) => (
              <article className="administrator-home__stat" key={key}>
                <h3>{label}</h3>
                <p>{overview.stats[key].toLocaleString()}</p>
              </article>
            ))}
          </section>

          <div className="administrator-home__sections">
            <section className="administrator-home__panel" aria-labelledby="account-distribution-title">
              <header className="administrator-home__panel-header">
                <h3 id="account-distribution-title">Account distribution</h3>
              </header>

              <div className="administrator-home__bar"
                role="img"
                aria-label={`Active users ${overview.stats.activeUsers}; disabled users ${overview.stats.disabledUsers}`}>
                {overview.stats.totalUsers === 0 ? (
                  <span className="administrator-home__bar-empty" />
                ) : (
                  <>
                    <span className="administrator-home__bar-active"
                      style={{ width: `${distribution.activePercent}%` }} />
                    <span className="administrator-home__bar-disabled"
                      style={{ width: `${distribution.disabledPercent}%` }} />
                  </>
                )}
              </div>
              <ul className="administrator-home__legend">
                <li>
                  <span className="administrator-home__legend-label">
                    <span className="administrator-home__dot administrator-home__dot--active" />
                    Active Users
                  </span>
                  <strong>{overview.stats.activeUsers.toLocaleString()}</strong>
                  <span>{Math.round(distribution.activePercent)}%</span>
                </li>
                <li>
                  <span className="administrator-home__legend-label">
                    <span className="administrator-home__dot administrator-home__dot--disabled" />
                    Disabled Users
                  </span>
                  <strong>{overview.stats.disabledUsers.toLocaleString()}</strong>
                  <span>{Math.round(distribution.disabledPercent)}%</span>
                </li>
              </ul>
            </section>

            <section className="administrator-home__panel" aria-labelledby="recent-users-title">
              <header className="administrator-home__panel-header">
                <h3 id="recent-users-title">Recently Registered</h3>
              </header>
              {overview.recentUsers.length === 0 ? (
                <p className="administrator-home__empty">No regular users have registered yet.</p>
              ) : (
                <ul className="administrator-home__recent-users">
                  {overview.recentUsers.map((user) => (
                    <li key={user.username}>
                      <span>{user.username}</span>
                      <time dateTime={user.createdAt}>{formatRegistrationDate(user.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
