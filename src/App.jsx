import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import ReaderPage from "./pages/ReaderPage";
import VocabularyPage from "./pages/VocabularyPage";
import ArticlesPage from "./pages/ArticlesPage";
import MigrationBanner from "./components/MigrationBanner";
import "./index.css";

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error || "Login failed.");
        return;
      }

      onLogin(body.username);
    } catch {
      setError("Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-logo">
          <BookOpen size={20} />
        </div>

        <h1>DeepRead</h1>

        <p className="auth-subtitle">
          Personal reading workspace
        </p>

        <div className="auth-fields">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="Username"
            required
            disabled={loading}
          />

          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Password"
            required
            disabled={loading}
          />
        </div>

        {error && (
          <p className="auth-error">
            {error}
          </p>
        )}

        <button
          className="auth-submit"
          type="submit"
          disabled={loading}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function App() {
  const [auth, setAuth] = useState({ loading: true, authenticated: false });
  const [page, setPage] = useState(() => localStorage.getItem("vocabulary-trainer:last-page") || "reader");
  const [article, setArticle] = useState("");
  const [articleTitle, setArticleTitle] = useState("");
  const [articleId, setArticleId] = useState(null);
  const [highlights, setHighlights] = useState([]);

  useEffect(() => { fetch('/api/auth/me', { credentials: 'include' }).then((response) => setAuth({ loading: false, authenticated: response.ok })).catch(() => setAuth({ loading: false, authenticated: false })); }, []);
  if (auth.loading) return <main className="auth-screen"><p>Loading...</p></main>;
  if (!auth.authenticated) return <LoginScreen onLogin={() => setAuth({ loading: false, authenticated: true })} />;

  function navigateTo(nextPage) {
    localStorage.setItem("vocabulary-trainer:last-page", nextPage);
    setPage(nextPage);
  }

  function openArticle(savedArticle) {
    setArticleId(savedArticle.id);
    setArticleTitle(savedArticle.title);
    setArticle(savedArticle.content);
    setHighlights(savedArticle.highlights || []);
    navigateTo("reader");
  }

  function newArticle() {
    setArticleId(null);
    setArticleTitle("");
    setArticle("");
    setHighlights([]);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1><BookOpen /> Turn pages, Open minds.</h1>
        <nav aria-label="Main navigation">
          <button className={page === "reader" ? "nav-button active" : "nav-button"} onClick={() => navigateTo("reader")}>Reader</button>
          <button className={page === "articles" ? "nav-button active" : "nav-button"} onClick={() => navigateTo("articles")}>My Articles</button>
          <button className={page === "vocabulary" ? "nav-button active" : "nav-button"} onClick={() => navigateTo("vocabulary")}>Vocabulary</button>
        </nav>
      </header>
      <MigrationBanner />
      {page === "reader" ? (
        <ReaderPage
          article={article}
          articleId={articleId}
          articleTitle={articleTitle}
          highlights={highlights}
          initialPage={articleId ? Number(localStorage.getItem(`vocabulary-trainer:article-page:${articleId}`) || 1) : 1}
          onArticleChange={setArticle}
          onTitleChange={setArticleTitle}
          onArticleSaved={openArticle}
          onNewArticle={newArticle}
        />
      ) : page === "articles" ? <ArticlesPage onOpenArticle={openArticle} /> : <VocabularyPage />}
    </div>
  );
}
