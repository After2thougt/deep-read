import { useEffect, useState } from "react";
import {
  BookOpen,
  Plus,
  ArrowRight,
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
   * 今天
   */
  const today = getDateOnly(new Date());


  /*
   * 只从历史文章中选择推荐文章。
   *
   * 使用 updatedAt：
   *
   * 今天更新过的文章
   * → 不推荐
   *
   * 之前更新的文章
   * → 可以推荐
   */
  const previousArticles = articles.filter(
    (article) => {
      if (!article) {
        return false;
      }

      const value =
        article.updatedAt ||
        article.createdAt;

      const articleDate =
        getDateOnly(value);

      if (!articleDate) {
        return false;
      }

      return articleDate < today;
    }
  );


  /*
   * 今天固定推荐一篇。
   */
  const featuredArticle =
    previousArticles.length > 0
      ? previousArticles[
          getDailyRandomIndex(
            previousArticles.length
          )
        ]
      : null;


  /*
   * 获取推荐文章的完整正文。
   *
   * /api/articles 列表接口
   * 只返回文章列表数据。
   *
   * /api/articles/:id
   * 才获取完整 content。
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
            className="home-new-button"
            type="button"
            onClick={onNewArticle}
          >
            <Plus size={18} />
            New Article
          </button>

        </div>


        <div className="home-hero__visual">

           <img
          src="/home-visual.png"
          alt="DeepRead"
          className="home-hero__image"
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

            {/* 日期 */}

            <div className="home-featured-article__date">
              {formatArticleDate(
                featuredArticle
              )}
            </div>


            {/* 标题 */}

            <h3>
              {featuredArticle.title ||
                "Untitled Article"}
            </h3>


            {/* 摘要 */}

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

            <BookOpen size={32} />

            <h3>
              No previous articles
            </h3>

            <p>
              Create a few articles and DeepRead
              will recommend one for you every day.
            </p>

            <button
              className="home-empty-button"
              type="button"
              onClick={onNewArticle}
            >
              <Plus size={16} />
              Create your first article
            </button>

          </div>

        )}

      </section>

      {/* =================================================
    VOCABULARY
    ================================================= */}

<section className="home-vocabulary">

  <div className="home-section-header">
    <div>
      <p className="home-eyebrow">
        VOCABULARY
      </p>

      <h2>
        Words to Remember
      </h2>
    </div>

    <button
      className="home-section-link"
      type="button"
      onClick={onOpenVocabulary}
    >
      View all
      <ArrowRight size={16} />
    </button>
  </div>

  {words.length > 0 ? (

    <div className="home-vocabulary-grid">

      {words.slice(0, 4).map((word) => (

        <article
          className="home-word-card"
          key={word.id || word.word}
          onClick={onOpenVocabulary}
        >

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

        </article>

      ))}

    </div>

  ) : (

    <div className="home-vocabulary-empty">
      <p>
        Save some words while reading and they will
        appear here.
      </p>

      <button
        type="button"
        onClick={onOpenVocabulary}
      >
        Go to Vocabulary
        <ArrowRight size={16} />
      </button>
    </div>

  )}

</section>

    </main>
  );
}