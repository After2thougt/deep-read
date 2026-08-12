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
  async function submit(event) {
    event.preventDefault(); setError("");
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username, password }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(body.error || 'Login failed.');
    onLogin(body.username);
  }
  return <main className="auth-screen"><form className="auth-form" onSubmit={submit}><p className="eyebrow">DeepRead</p><h1>Sign in</h1><label className="input-label">Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label><label className="input-label">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="error-message">{error}</p>}<button className="primary-button" type="submit">Sign in</button></form></main>;
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
          <button className={page === "vocabulary" ? "nav-button active" : "nav-button"} onClick={() => navigateTo("vocabulary")}>Vocabulary Bank</button>
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
