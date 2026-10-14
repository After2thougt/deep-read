import { useEffect, useState } from "react";
import {
  BookOpen,
  Plus,
  ArrowRight,
  Type,
  Feather,
  Trophy,
} from "lucide-react";

import { fetchArticle } from "../api/articles";


function getArticlePreview(content, maxLength = 180) {
  if (!content) {
    return "No content yet.";
  }

  const text = String(content)
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}…`;
}


function getDateOnly(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}


function formatArticleDate(article) {
  const value =
    article.updatedAt ||
    article.createdAt;

  const date = getDateOnly(value);

  if (!date) {
    return "";
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}


/**
 * 根据日期生成一个稳定的随机数。
 *
 * 同一天：
 *   seed 相同 → 推荐文章不会变化
 *
 * 第二天：
 *   seed 不同 → 推荐文章可能变化
 */
function getDailyRandomIndex(length) {
  if (!length) {
    return -1;
  }

  const today = new Date();

  const seed =
    today.getFullYear() * 10000 +
    (today.getMonth() + 1) * 100 +
    today.getDate();

  const random =
    Math.abs(Math.sin(seed) * 10000) % 1;

  return Math.floor(random * length);
}


export default function HomePage({
  articles = [],
  words = [],
  onOpenArticle,
  onNewArticle,
  onOpenVocabulary,
}) {
  const [featuredContent, setFeaturedContent] =
    useState("");

  const [loadingContent, setLoadingContent] =
    useState(false);


  /*
   * today
   */
  const today = getDateOnly(new Date());


  
  /*
   * select articles that were created or updated before today.
   */
  const previousArticles = articles.filter((article) => {
    if (!article) {
      return false;
    }

    const value = article.updatedAt || article.createdAt;
    const articleDate = getDateOnly(value);

    return articleDate && articleDate < today;
  });

  /*
   * if there are no previous articles, use all existing articles.
   * that way, if there is only one article created today, it can still be displayed.
   */
  const recommendationPool =
    previousArticles.length > 0
      ? previousArticles
      : articles.filter((article) => article?.id);

  /*
   * recmmond a article every day
   */
  const featuredArticle =
    recommendationPool.length > 0
      ? recommendationPool[
          getDailyRandomIndex(recommendationPool.length)
        ]
      : null;


  /*
   * fetch recommended article content.
   *
   * /api/articles List interface 
   * only returns article list data.
   *
   * /api/articles/:id
   * get the whole content。
   */
  useEffect(() => {
    if (!featuredArticle?.id) {
      setFeaturedContent("");
      return;
    }

    let cancelled = false;

    setLoadingContent(true);

    fetchArticle(featuredArticle.id)
      .then((article) => {
        if (!cancelled) {
          setFeaturedContent(
            article.content || ""
          );
        }
      })
      .catch((error) => {
        console.error(
          "Failed to load featured article:",
          error
        );

        if (!cancelled) {
          setFeaturedContent("");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingContent(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [featuredArticle?.id]);


  return (
    <main className="home-page">

      {/* =================================================
          HERO
          ================================================= */}

      <section className="home-hero">

        <div className="home-hero__content">

          <p className="home-eyebrow">
            DEEPREAD
          </p>

          <h1>
            Read deeper.
          </h1>

          <p className="home-hero__description">
            Read, understand, and study the articles
            that matter to you.
          </p>

          
          <button
            className="home-new-button tag-tool-button"
            type="button"
            onClick={onNewArticle}
            aria-label="New Article"
            data-tooltip="New Article" 
          >

            <Plus size={21} strokeWidth={1.8} />
          </button>


        </div>


        <div className="home-hero__visual">
          <img
            src="/home-visual.webp"
            className="home-hero__image light-image"
            alt="DeepRead"
          />

          <img
            src="/home-visual-dark.webp"
            className="home-hero__image dark-image"
            alt=""
          />
        </div>

      </section>


      {/* =================================================
          READING ROOM
          ================================================= */}

      <section className="home-reading">

        <div className="home-section-header">

          <div>

            <p className="home-eyebrow">
              READING ROOM
            </p>

            <h2>
              Today’s Reading
            </h2>

          </div>

        </div>


        {featuredArticle ? (

          <article
            className="home-featured-article"
            onClick={() =>
              onOpenArticle(featuredArticle)
            }
          >

            {/* DATE */}

            <div className="home-featured-article__date">
              {formatArticleDate(
                featuredArticle
              )}
            </div>


            {/* TITLE */}

            <h3>
              {featuredArticle.title ||
                "Untitled Article"}
            </h3>


            {/* PREVIEW */}

            <p className="home-featured-article__preview">

              {loadingContent
                ? "Loading..."
                : getArticlePreview(
                    featuredContent
                  )}

            </p>


            {/* Footer */}

            <div className="home-featured-article__footer">

              <span>
                Open article
              </span>

              <ArrowRight size={18} />

            </div>

          </article>

        ) : (

          <div className="home-empty">

            <BookOpen size={34} strokeWidth={1.6} />

            <h3>
              No previous articles
            </h3>

            <p>
              Create a few articles and DeepRead
              will recommend one for you every day.
            </p>

            <button
              className="home-empty-button tag-tool-button"
              type="button"
              onClick={onNewArticle}
              aria-label="New Article"
              data-tooltip="New Article"

            >
              <Plus size={21} strokeWidth={1.8} />
            </button>

          </div>

        )}

      </section>

{/* =================================================
    VOCABULARY
    ================================================= */}

<section className="home-vocabulary">

  <div className="home-vocabulary__header">
    <div className="home-vocabulary__heading">
      <p className="home-eyebrow">
        VOCABULARY
      </p>

      <h2>
        Words to Remember
      </h2>

 
    </div>

  
  </div>

  {words.length > 0 ? (
    <div className="home-vocabulary-grid">

      {words.slice(0, 4).map((word) => (
        <button
          className="home-word-card"
          key={word.id || word.word}
          type="button"
          onClick={onOpenVocabulary}
        >
          <div className="home-word-card__top">
            <span className="home-word-card__icon" aria-hidden="true">
            {[
              <BookOpen size={20} strokeWidth={1.8} />,
              <Type size={20} strokeWidth={1.8} />,
              <Feather size={20} strokeWidth={1.8} />,
              <Trophy  size={20} strokeWidth={1.8} />,
            ][words.slice(0, 4).indexOf(word)]}
          </span>

            <span className="home-word-card__arrow" aria-hidden="true">
              <ArrowRight size={18} />
            </span>
          </div>

          <div className="home-word-card__word">
            {word.word}
          </div>

          {word.partOfSpeech && (
            <div className="home-word-card__pos">
              {word.partOfSpeech}
            </div>
          )}

          <p className="home-word-card__definition">
            {word.definition || "No definition yet."}
          </p>
        </button>
      ))}

    </div>
  ) : (
    <div className="home-vocabulary-empty">
      <div className="home-vocabulary-empty__icon">
        <BookOpen size={34} strokeWidth={1.6} />
      </div>

      <h3>No vocabulary yet</h3>

      <p>
        Save words while reading and they will appear here.
      </p>

      <button
        className="home-vocabulary-empty__button tag-tool-button"
        type="button"
        aria-label="go to vocabulary"
        data-tooltip="go to vocabulary" 
        onClick={onOpenVocabulary}
      >
        
        <ArrowRight size={17} />
      </button>
    </div>
  )}

</section>


    </main>
  );
}