import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Routes, Route, NavLink, useNavigate, useLocation } from "react-router-dom";

import ReaderPage from "./pages/ReaderPage";
import VocabularyPage from "./pages/VocabularyPage";
import ArticlesPage from "./pages/ArticlesPage";
import HomePage from "./pages/HomePage";
import ProfilePage from "./pages/ProfilePage";
import NotesPage from "./pages/NotesPage";
import ArticleNotesPage from "./pages/ArticleNotesPage";
import UserManagementPage from "./pages/UserManagementPage";
import { clearVocabularyCache, fetchVocabulary } from "./api/vocabulary";
import UserMenu from "./components/ui/UserMenu";
import { DEFAULT_LOGIN_PATH, getNavigationItems, getRoleRedirect } from "./routing/access";

import {
  House,
  Newspaper,
  LibraryBig,
  Highlighter,
  BookOpen,
  Users,
} from "lucide-react";

import {
  fetchArticles,
  fetchArticle,
  prefetchArticles,
  clearArticleListCache,
} from "./api/articles";

import { safeGetItem, safeSetItem, safeRemoveItem, setStorageAccount } from "./utils/storage";

import "./index.css";

const NAVIGATION_ICONS = {
  home: House,
  articles: LibraryBig,
  vocabulary: Newspaper,
  highlight: Highlighter,
  users: Users,
};

function clearSessionCaches() {
  clearArticleListCache();
  clearVocabularyCache();
}

function LoginScreen({ onLogin }) {
  const navigate = useNavigate();
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

      onLogin(body.userId, body.username, body.role);
      navigate(DEFAULT_LOGIN_PATH, { replace: true });
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


function AppRoutes({onLogout, username, role, authenticated}) {
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
    clearArticleListCache();
    setArticleListVersion((value) => value + 1);
  }

  /*
   * =====================================================
   * LOAD HOME ARTICLES
   * =====================================================
   */

    useEffect(() => {
      if (!authenticated || (role === "administrator" && location.pathname !== "/")) {
        setHomeArticles([]);
        return;
      }

    let cancelled = false;

    fetchArticles({
      page: 1,
      limit: 100,
      tag: "all",
      force: true,
    })
      .then((result) => {
        if (!cancelled) {
          setHomeArticles(result.items || []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load home articles:", error);
          setHomeArticles([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated, role, location.pathname, articleListVersion]);


/*
 * =====================================================
 * LOAD HOME VOCABULARY
 * =====================================================
 */

useEffect(() => {
  if (!authenticated || (role === "administrator" && location.pathname !== "/")) {
    setHomeWords([]);
    return;
  }

  let cancelled = false;

  fetchVocabulary({
    page: 1,
    limit: 4,
    sort: "recent",
    search: "",
  })
    .then((result) => {
      if (!cancelled) {
        setHomeWords(result.items || []);
      }
    })
    .catch((error) => {
      if (!cancelled) {
        console.error("Failed to load home vocabulary:", error);
        setHomeWords([]);
      }
    });

  return () => {
    cancelled = true;
  };
}, [authenticated, role, location.pathname]);

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
      setArticle("");
      setArticleTitle("");
      setHighlights([]);
      setArticleBlocks([]);
      navigate("/articles/new");
    }
  function goToArticles() {
    navigate("/articles");
  }

  const accessRedirect = getRoleRedirect(role, location.pathname);
  if (accessRedirect) {
    return <Navigate to={accessRedirect} replace />;
  }

  /*
   * =====================================================
   * HEADER
   * =====================================================
   */

  return (
    <>
      <header className="app-header">
        <h1 className="app-brand">
          
          <span className="app-brand-copy">Turn pages, Open minds.</span>
        </h1>

        
        <nav className="app-nav" aria-label="Main navigation">
          {getNavigationItems(role).map(({ path, label, icon }) => {
            const Icon = NAVIGATION_ICONS[icon];
            const isArticles = path === "/articles";
            return (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) => isActive ? "nav-button active" : "nav-button"}
                end={path === "/"}
                onMouseEnter={isArticles ? prefetchArticles : undefined}
                onFocus={isArticles ? prefetchArticles : undefined}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{label}</span>
              </NavLink>
            );
          })}
        </nav>


        <div className="app-header-actions">
          <UserMenu
            username={username}
            role={role}
            onLogout={onLogout}
          />
        </div>
      </header>


      <Routes>
        <Route
          path="/admin/users"
          element={<UserManagementPage />}
        />
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
            onArticleDeleted={(deletedId) => {
              setHomeArticles((current) =>
                current.filter(
                  (item) => String(item.id) !== String(deletedId)
                )
              );
              setArticleListVersion((version) => version + 1);
            }}
          />
        }
      />

        <Route
          path="/articles/new"
          element={
            <ReaderPage
              key="new-article"
              role={role}
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
              role={role}
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
          path="/highlight"
          element={<NotesPage />}
        />
        <Route
          path="/highlight/:articleId"
          element={<ArticleNotesPage />}
        />
        <Route
          path="/about"
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

function AuthenticatedApp({ auth, onLogout }) {
  return (
    <div className="app">
      <AppRoutes
        onLogout={onLogout}
        username={auth.username}
        role={auth.role}
        authenticated={auth.authenticated}
      />
    </div>
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
    userId: null,
    username: "",
    role: "",
  });

  async function logout() {
    clearSessionCaches();
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      setStorageAccount(null);
      setAuth({
        loading: false,
        authenticated: false,
        userId: null,
        username: "",
        role: "",
      });
    }
  }

  useEffect(() => {
    fetch("/api/auth/me", {
      credentials: "include",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        setStorageAccount(response.ok ? body.userId : null, body.role);
        setAuth({
          loading: false,
          authenticated: response.ok,
          userId: response.ok ? body.userId : null,
          username: body.username || "",
          role: body.role || "",
        });
      })
      .catch(() => {
        setStorageAccount(null);
        setAuth({
          loading: false,
          authenticated: false,
          userId: null,
          username: "",
          role: "",
        });
      });
  }, []);

  return (
    <BrowserRouter>
      {auth.loading ? (
        <main className="auth-screen">
          <p>Loading...</p>
        </main>
      ) : auth.authenticated ? (
        <AuthenticatedApp auth={auth} onLogout={logout} />
      ) : (
        <LoginScreen
          onLogin={(userId, username, role) => {
            clearSessionCaches();
            setStorageAccount(userId, role);
            setAuth({
              loading: false,
              authenticated: true,
              userId,
              username,
              role: role || "",
            });
          }}
        />
      )}
    </BrowserRouter>
  );
}
