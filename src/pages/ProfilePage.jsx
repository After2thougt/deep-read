import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Layers3,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";

export default function ProfilePage() {
  return (
    <main className="profile-page">
    
      {/* Hero */}
      <section className="profile-hero">
        <div className="profile-hero__content">
          <div className="profile-eyebrow">
            <span className="profile-eyebrow__line" />
            ABOUT DEEP READ
          </div>

          <h1 className="profile-hero__title">
            Read deeper.
            <br />
            Learn
            <br />
            <span className="profile-hero__title-accent">
              naturally.
            </span>
          </h1>

          <p className="profile-hero__description">
            A little curiosity goes a long way. Turn the articles
            you love into opportunities to build vocabulary,
            understand language, and grow your reading skills.
          </p>

          <a className="profile-hero__link" href="#our-approach">
            <span>Explore our approach</span>
            <ArrowDownRight size={18} strokeWidth={1.7} />
          </a>
        </div>

        {/* Editorial illustration */}
        <div
          className="profile-visual"
          aria-label="An illustration inspired by books and reading"
          role="img"
        >
          <div className="profile-visual__sun" />
          <div className="profile-visual__orbit" />

          <div className="profile-visual__paper profile-visual__paper--back">
            <span className="profile-visual__paper-label">
              NOTES ON READING
            </span>
            <span className="profile-visual__paper-line" />
            <span className="profile-visual__paper-line" />
            <span className="profile-visual__paper-line short" />
          </div>

          <div className="profile-visual__book">
            <div className="profile-visual__page profile-visual__page--left">
              <span className="profile-visual__chapter">
                CHAPTER 01
              </span>
              <span className="profile-visual__page-title">
                The art
                <br />
                of noticing
              </span>
              <span className="profile-visual__rule" />
              <span className="profile-visual__text-lines">
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>

            <div className="profile-visual__page profile-visual__page--right">
              <span className="profile-visual__chapter">
                NEW WORDS
              </span>

              <span className="profile-visual__word">
                curious
              </span>
              <span className="profile-visual__definition">
                eager to know or learn
                something
              </span>

              <span className="profile-visual__word">
                wonder
              </span>
              <span className="profile-visual__definition">
                a feeling of surprise
                and admiration
              </span>
            </div>
          </div>

          <div className="profile-visual__note">
            <Sparkles size={14} strokeWidth={1.7} />
            <span>Every page is a new beginning.</span>
          </div>

          <div className="profile-visual__caption">
            READ · NOTICE · REMEMBER
          </div>
        </div>
      </section>

      {/* Philosophy */}
      <section
        className="profile-approach"
        id="our-approach"
      >
        <div className="profile-section-heading">
          <span className="profile-section-heading__label">
            THE WAY WE LEARN
          </span>
          <span className="profile-section-heading__line" />
          <span className="profile-section-heading__index">
            01 — 03
          </span>
        </div>

        <div className="profile-features">
          <article className="profile-feature">
            <div className="profile-feature__top">
              <span className="profile-feature__number">
                01
              </span>
              <BookOpen
                className="profile-feature__icon"
                size={22}
                strokeWidth={1.5}
              />
            </div>

            <h2>Read at your own pace.</h2>

            <p>
              Follow your curiosity. Enjoy interesting articles
              without rushing through every sentence.
            </p>
          </article>

          <article className="profile-feature">
            <div className="profile-feature__top">
              <span className="profile-feature__number">
                02
              </span>
              <Bookmark
                className="profile-feature__icon"
                size={22}
                strokeWidth={1.5}
              />
            </div>

            <h2>Make words your own.</h2>

            <p>
              Collect useful vocabulary, explore unfamiliar
              expressions, and return to what you have learned.
            </p>
          </article>

          <article className="profile-feature">
            <div className="profile-feature__top">
              <span className="profile-feature__number">
                03
              </span>
              <Layers3
                className="profile-feature__icon"
                size={22}
                strokeWidth={1.5}
              />
            </div>

            <h2>Keep growing, naturally.</h2>

            <p>
              Bring your reading, notes, and learning progress
              together in one personal space.
            </p>
          </article>
        </div>
      </section>

      {/* Closing statement */}
      <section className="profile-closing">
        <div className="profile-closing__mark">
          <BookOpen size={21} strokeWidth={1.5} />
        </div>

        <div className="profile-closing__content">
          <span className="profile-closing__eyebrow">
            A NOTE TO OUR READERS
          </span>

          <p>
            You don't have to learn everything today.
            <br />
            Just keep turning the page.
          </p>
        </div>

        <Link to="/articles" className="profile-closing__arrow">
          <ArrowUpRight size={23} strokeWidth={1.5} />
        </Link>
      </section>

      {/* Footer */}
      <footer className="profile-footer">
        <span className="profile-footer__copyright">
          DEEP READ
        </span>

        <span className="profile-footer__motto">
          A little progress, every day.
        </span>

        <a
          className="profile-footer__support"
          href="mailto:support@deepread.com"
        >
          Get in touch
          <ArrowUpRight size={14} />
        </a>
      </footer>
    </main>
  );
}
