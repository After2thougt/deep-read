import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";

import ReaderPage from "./pages/ReaderPage";
import VocabularyPage from "./pages/VocabularyPage";
import ArticlesPage from "./pages/ArticlesPage";
import HomePage from "./pages/HomePage";
import MigrationBanner from "./components/MigrationBanner";
import { fetchVocabulary } from "./api/vocabulary";

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


export default function App() {
  /*
   * =====================================================
   * AUTH
   * =====================================================
   */

  const [auth, setAuth] = useState({
    loading: true,
    authenticated: false,
  });


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
   * PAGE
   * =====================================================
   *
   * home
   * reader
   * articles
   * vocabulary
   */

  const [page, setPage] = useState(
    () =>
      safeGetItem(
        "vocabulary-trainer:last-page"
      ) || "home"
  );



  /*
   * =====================================================
   * CURRENT ARTICLE
   * =====================================================
   *
   * 当前 Reader 正在编辑的文章
   */

  // Persist only the current article ID to localStorage.
  // On refresh, we restore the ID and re-fetch the article from the backend.
  const [articleId, setArticleId] = useState(() => {
    return safeGetItem("deepread:current-article-id") || null;
  });

  const [article, setArticle] = useState("");
  const [articleTitle, setArticleTitle] = useState("");
  const [highlights, setHighlights] = useState([]);
  const [articleBlocks, setArticleBlocks] = useState([]);

  // Track whether we've already restored the article on initial load
  const articleRestoredRef = useRef(false);

  // Restore article from backend when articleId is loaded from localStorage on initial mount
  useEffect(() => {
    if (!articleId || articleRestoredRef.current) return;

    articleRestoredRef.current = true;

    fetchArticle(articleId)
      .then((fullArticle) => {
        setArticleTitle(fullArticle.title || "");
        setArticle(fullArticle.content || "");
        setHighlights(fullArticle.highlights || []);
        setArticleBlocks(fullArticle.blocks || []);
      })
      .catch((error) => {
        console.error("Failed to restore article:", error);
        // If restore fails, clear the invalid ID
        setArticleId(null);
      });
  }, [articleId]);

  // Persist articleId to localStorage
  useEffect(() => {
    if (articleId) {
      safeSetItem("deepread:current-article-id", articleId);
    } else {
      safeRemoveItem("deepread:current-article-id");
    }
  }, [articleId]);



  /*
   * =====================================================
   * HOME ARTICLES
   * =====================================================
   *
   * HomePage 的 Reading Room 使用这些文章
   */

  const [homeArticles, setHomeArticles] = useState([]);
  const [homeWords, setHomeWords] = useState([]);
  const [articleListVersion, setArticleListVersion] = useState(0);

  function handleArticleSaved(savedArticle) {
  clearArticleListCache();
  setArticleListVersion((value) => value + 1);
  openArticle(savedArticle);
}


  /*
   * =====================================================
   * LOGIN CHECK
   * =====================================================
   *
   * 页面第一次加载时检查当前 session。
   */

  useEffect(() => {
    fetch("/api/auth/me", {
      credentials: "include",
    })
      .then((response) => {
        setAuth({
          loading: false,
          authenticated: response.ok,
        });
      })
      .catch(() => {
        setAuth({
          loading: false,
          authenticated: false,
        });
      });
  }, []);


  /*
   * =====================================================
   * LOAD HOME ARTICLES
   * =====================================================
   *
   * 登录成功后加载文章列表。
   *
   * HomePage 会从这些文章中选择历史文章进行推荐。
   */

useEffect(() => {
  if (!auth.authenticated) {
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
      console.error(
        "Failed to load home articles:",
        error
      );

      setHomeArticles([]);
    });
}, [auth.authenticated]);

useEffect(() => {
  if (!auth.authenticated) {
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
      console.error(
        "Failed to load home vocabulary:",
        error
      );

      setHomeWords([]);
    });
}, [auth.authenticated]);


  /*
   * =====================================================
   * LOADING
   * =====================================================
   */

  if (auth.loading) {
    return (
      <main className="auth-screen">
        <p>Loading...</p>
      </main>
    );
  }


  /*
   * =====================================================
   * LOGIN
   * =====================================================
   */

  if (!auth.authenticated) {
    return (
      <LoginScreen
        onLogin={() =>
          setAuth({
            loading: false,
            authenticated: true,
          })
        }
      />
    );
  }


  /*
   * =====================================================
   * PAGE NAVIGATION
   * =====================================================
   */

  function navigateTo(nextPage) {
    safeSetItem(
      "vocabulary-trainer:last-page",
      nextPage
    );

    setPage(nextPage);
  }

  function goToArticles() {
    navigateTo("articles");
  }


  /*
   * =====================================================
   * OPEN ARTICLE
   * =====================================================
   *
   * Home → Reader
   * My Articles → Reader
   */
async function openArticle(savedArticle) {
  try {
    const fullArticle = await fetchArticle(savedArticle.id);

    setArticleId(fullArticle.id);
    setArticleTitle(fullArticle.title || "");
    setArticle(fullArticle.content || "");
    setHighlights(fullArticle.highlights || []);
    setArticleBlocks(fullArticle.blocks || []);

    navigateTo("reader");
  } catch (error) {
    console.error("Failed to open article:", error);

    setArticleId(savedArticle.id);
    setArticleTitle(savedArticle.title || "");
    setArticle(savedArticle.content || "");
    setHighlights(savedArticle.highlights || []);
    setArticleBlocks(savedArticle.blocks || []);

    navigateTo("reader");
  }
}

  /*
   * =====================================================
   * NEW ARTICLE
   * =====================================================
   *
   * 新文章直接进入 Reader。
   */

function newArticle() {
  setArticleId(null);
  setArticleTitle("");
  setArticle("");
  setHighlights([]);
  setArticleBlocks([]);

 
  navigateTo("reader");
}


  /*
   * =====================================================
   * APP
   * =====================================================
   */

  return (
    <div className="app">

      {/* =================================================
          HEADER
          ================================================= */}

      <header className="app-header">

        <h1>
          <BookOpen />
          Turn pages, Open minds.
        </h1>

        <nav aria-label="Main navigation">

          {/* HOME */}

          <button
            className={
              page === "home"
                ? "nav-button active"
                : "nav-button"
            }
            onClick={() => navigateTo("home")}
          >
            Home
          </button>


          {/* MY ARTICLES */}

          <button
            className={
              page === "articles"
                ? "nav-button active"
                : "nav-button"
            }
            onMouseEnter={prefetchArticles}
            onFocus={prefetchArticles}
            onClick={() => navigateTo("articles")}
          >
            My Articles
          </button>


          {/* VOCABULARY */}

          <button
            className={
              page === "vocabulary"
                ? "nav-button active"
                : "nav-button"
            }
            onClick={() => navigateTo("vocabulary")}
          >
            Vocabulary
          </button>

        </nav>

      </header>



      {/* =================================================
          MIGRATION
          ================================================= */}

      <MigrationBanner />


      {/* =================================================
          HOME
          =================================================
          
          Home 只负责展示文章。

          点击文章：
              Home → Reader

          新文章：
              Home → Reader
          ================================================= */}

      {page === "home" && (
        <HomePage
          articles={homeArticles}
          words={homeWords}
          onOpenArticle={openArticle}
          onNewArticle={newArticle}
          onOpenVocabulary={() =>
            navigateTo("vocabulary")
    }
  />)
}



      {/* =================================================
          READER
          =================================================
          
          Reader 是真正的文章工作区。

          包含：

          ArticleInput
          Reading Room
          Dictionary
          Translation
          AI Analysis
          ================================================= */}

      {page === "reader" && (
  <ReaderPage
  
    article={article}
    articleId={articleId}
    articleTitle={articleTitle}
    highlights={highlights}
    blocks={articleBlocks}

    onBlocksChange={setArticleBlocks}

    initialPage={
      articleId
        ? Number(
            safeGetItem(
              `vocabulary-trainer:article-page:${articleId}`
            ) || 1
          )
        : 1
    }

    onArticleChange={setArticle}
    onTitleChange={setArticleTitle}

    onArticleSaved={handleArticleSaved}

    onNewArticle={newArticle}
    onBackToArticles={goToArticles}

    theme={theme}
    setTheme={setTheme}
  />)
}



      {/* =================================================
          MY ARTICLES
          ================================================= */}

      {page === "articles" && (
          <ArticlesPage
            onOpenArticle={openArticle}
            refreshVersion={articleListVersion}
          />
        )}



      {/* =================================================
          VOCABULARY
          ================================================= */}

      {page === "vocabulary" && (
        <VocabularyPage />
      )}



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

    </div>
  );
}