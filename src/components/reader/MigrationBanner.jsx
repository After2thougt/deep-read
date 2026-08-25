import { useState } from "react";
import { Upload } from "lucide-react";
import { dismissMigration, getLocalDataSummary, migrateLocalDataToDatabase } from "../../api/migrate";

export default function MigrationBanner() {
  const [summary] = useState(getLocalDataSummary);
  const [visible, setVisible] = useState(() => Boolean(getLocalDataSummary()));
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  if (!visible || !summary) return null;

  async function handleMigrate() {
    setMigrating(true);
    setError("");
    try {
      const syncResult = await migrateLocalDataToDatabase();
      setResult(syncResult);
      window.setTimeout(() => setVisible(false), 4000);
    } catch (err) {
      setError(err.message || "Unable to import local data.");
    } finally {
      setMigrating(false);
    }
  }

  function handleDismiss() {
    dismissMigration();
    setVisible(false);
  }

  const parts = [];
  if (summary.articleCount) parts.push(`${summary.articleCount} article${summary.articleCount === 1 ? "" : "s"}`);
  if (summary.vocabularyCount) parts.push(`${summary.vocabularyCount} word${summary.vocabularyCount === 1 ? "" : "s"}`);

  return (
    <section className="migration-banner" aria-live="polite">
      <div>
        <p className="eyebrow">Local data found</p>
        {result ? (
          <p className="save-message">Imported {result.articlesSaved} article{result.articlesSaved === 1 ? "" : "s"} and {result.vocabularySaved} word{result.vocabularySaved === 1 ? "" : "s"}.</p>
        ) : (
          <p>Found {parts.join(" and ")} saved in this browser. Import them into your library?</p>
        )}
        {error && <p className="error-message">{error}</p>}
      </div>
      {!result && (
        <div className="migration-banner__actions">
          <button className="secondary-button" type="button" onClick={handleDismiss} disabled={migrating}>Dismiss</button>
          <button className="primary-button migration-import-button" type="button" onClick={handleMigrate} disabled={migrating}>
            <Upload size={18} />
            {migrating ? "Importing..." : "Import"}
          </button>
        </div>
      )}
    </section>
  );
}
