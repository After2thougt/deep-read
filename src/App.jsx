import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { BrowserRouter, Routes, Route, NavLink, useNavigate, useLocation } from "react-router-dom";

import ReaderPage from "./pages/ReaderPage";
import VocabularyPage from "./pages/VocabularyPage";
import ArticlesPage from "./pages/ArticlesPage";
import HomePage from "./pages/HomePage";
import ProfilePage from "./pages/ProfilePage";
import MigrationBanner from "./components/reader/MigrationBanner";
import { fetchVocabulary } from "./api/vocabulary";
import UserMenu from "./components/ui/UserMenu";

import {
  fetchArticles,
  fetchArticle,
  prefetchArticles,
  clearArticleListCache,
} from "./api/articles";

import { safeGetItem, safeSetItem, safeRemoveItem } from "./utils/storage";

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
        body: JSON.stringify({
          username,
          password,
        }),
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


function AppRoutes({onLogout, username, authenticated}) {
  const navigate = useNavigate();
  const location = useLocation();

  /*
   * =====================================================
   * THEME
   * =====================================================
   */

  const [theme, setTheme] = useState(() => {
    return safeGetItem("deepread-theme") || "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    safeSetItem("deepread-theme", theme);
  }, [theme]);

  /*
   * =====================================================
   * CURRENT ARTICLE STATE
   * =====================================================
   */

  const [article, setArticle] = useState("");
  const [articleTitle, setArticleTitle] = useState("");
  const [highlights, setHighlights] = useState([]);
  const [articleBlocks, setArticleBlocks] = useState([]);

  /*
   * =====================================================
   * HOME ARTICLES
   * =====================================================
   */

  const [homeArticles, setHomeArticles] = useState([]);
  const [homeWords, setHomeWords] = useState([]);
  const [articleListVersion, setArticleListVersion] = useState(0);

  function handleArticleSaved(savedArticle) {
    console.log("[App handleArticleSaved] savedArticle:", { id: savedArticle.id, title: savedArticle.title });
    clearArticleListCache();
    setArticleListVersion((value) => value + 1);
  }

  /*
   * =====================================================
   * LOAD HOME ARTICLES
   * =====================================================
   */

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    fetchArticles({
      page: 1,
      limit: 100,
      tag: "all",
    })
      .then((result) => {
        console.log("HOME ARTICLES RESULT:", result);
        console.log("HOME ARTICLES ITEMS:", result.items);
        setHomeArticles(result.items || []);
      })
      .catch((error) => {
        console.error("Failed to load home articles:", error);
        setHomeArticles([]);
      });
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    fetchVocabulary({
      page: 1,
      limit: 5,
      sort: "recent",
    })
      .then((result) => {
        setHomeWords(result.items || []);
      })
      .catch((error) => {
        console.error("Failed to load home vocabulary:", error);
        setHomeWords([]);
      });
  }, [authenticated]);

  /*
   * =====================================================
   * NAVIGATION HELPERS
   * =====================================================
   */

  async function openArticle(savedArticle) {
    try {
      const fullArticle = await fetchArticle(savedArticle.id);
      setArticle(fullArticle.content || "");
      setArticleTitle(fullArticle.title || "");
      setHighlights(fullArticle.highlights || []);
      setArticleBlocks(fullArticle.blocks || []);
    } catch (error) {
      console.error("Failed to open article:", error);
      setArticle(savedArticle.content || "");
      setArticleTitle(savedArticle.title || "");
      setHighlights(savedArticle.highlights || []);
      setArticleBlocks(savedArticle.blocks || []);
    }
    navigate(`/articles/${savedArticle.id}`);
  }

    function newArticle() {
      console.log("New article clicked");

      setArticle("");
      setArticleTitle("");
      setHighlights([]);
      setArticleBlocks([]);

      console.log("before navigate");

      navigate("/articles/new");

      console.log("after navigate");
    }
  function goToArticles() {
    navigate("/articles");
  }

  /*
   * =====================================================
   * HEADER
   * =====================================================
   */

  return (
    <>
      <header className="app-header">
        <h1>
          <BookOpen />
          Turn pages, Open minds.
        </h1>

        <nav aria-label="Main navigation">
          <NavLink
            to="/"
            className={({ isActive }) => isActive ? "nav-button active" : "nav-button"}
            onClick={() => navigate("/")}
          >
            Home
          </NavLink>

          <NavLink
            to="/articles"
            className={({ isActive }) => isActive ? "nav-button active" : "nav-button"}
            onMouseEnter={prefetchArticles}
            onFocus={prefetchArticles}
          >
            My Articles
          </NavLink>

          <NavLink
            to="/vocabulary"
            className={({ isActive }) => isActive ? "nav-button active" : "nav-button"}
          >
            Vocabulary
          </NavLink>

          <UserMenu
            username={username}
            onLogout={onLogout}
        />

        </nav>
            
        
      </header>

      <MigrationBanner />

      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              articles={homeArticles}
              words={homeWords}
              onOpenArticle={openArticle}
              onNewArticle={newArticle}
              onOpenVocabulary={() => navigate("/vocabulary")}
            />
          }
        />
        <Route
          path="/articles"
          element={
            <ArticlesPage
              onOpenArticle={openArticle}
              refreshVersion={articleListVersion}
            />
          }
        />
        <Route
          path="/articles/new"
          element={
            <ReaderPage
              key="new-article"
              article={article}
              articleId={null}
              articleTitle={articleTitle}
              highlights={highlights}
              blocks={articleBlocks}
              onBlocksChange={setArticleBlocks}
              initialPage={1}
              onArticleChange={setArticle}
              onTitleChange={setArticleTitle}
              onArticleSaved={handleArticleSaved}
              onNewArticle={newArticle}
              onBackToArticles={goToArticles}
              theme={theme}
              setTheme={setTheme}
              isNewArticle={true}
            />
          }
        />
        <Route
          path="/articles/:id"
          element={
            <ReaderPage
              key={location.pathname}
              article={article}
              articleId={null} // Will be fetched from URL in ReaderPage
              articleTitle={articleTitle}
              highlights={highlights}
              blocks={articleBlocks}
              onBlocksChange={setArticleBlocks}
              initialPage={1}
              onArticleChange={setArticle}
              onTitleChange={setArticleTitle}
              onArticleSaved={handleArticleSaved}
              onNewArticle={newArticle}
              onBackToArticles={goToArticles}
              theme={theme}
              setTheme={setTheme}
            />
          }
        />
        <Route
          path="/vocabulary"
          element={<VocabularyPage />}
        />
        <Route
          path="/profile"
          element={
            <ProfilePage
              username={username}
              onLogout={onLogout}
            />
          }
        />
      </Routes>

      <footer className="app-footer">
        <div className="app-footer__brand">
          <strong>DeepRead</strong>
          <span>Personal Reading Workspace</span>
        </div>
        <div className="app-footer__meta">
          <span>© 2026 DeepRead</span>
          <span>Turn pages, Open minds.</span>
        </div>
      </footer>
    </>
  );
}


export default function App() {
  /*
   * =====================================================
   * AUTH
   * =====================================================
   */

  const [auth, setAuth] = useState({
    loading: true,
    authenticated: false,
    username: "",
  });

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Logout failed:", error);
    }

    setAuth({
      loading: false,
      authenticated: false,
      username: "",
    });
    window.location.replace("/");
  }

  useEffect(() => {
    fetch("/api/auth/me", {
      credentials: "include",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        setAuth({
          loading: false,
          authenticated: response.ok,
          username: body.username || "",
        });
      })
      .catch(() => {
        setAuth({
          loading: false,
          authenticated: false,
          username: "",
        });
      });
  }, []);

  if (auth.loading) {
    return (
      <main className="auth-screen">
        <p>Loading...</p>
      </main>
    );
  }

  if (!auth.authenticated) {
    return (
      <LoginScreen
        onLogin={(username) => {
          setAuth({
            loading: false,
            authenticated: true,
            username,
          });

          window.location.replace("/");
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      <div className="app">
        <AppRoutes 
          onLogout={logout}
          username={auth.username}
          authenticated={auth.authenticated}
        />
      </div>
    </BrowserRouter>
  );
}