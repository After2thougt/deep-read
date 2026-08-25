import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Trash2, X } from "lucide-react";
import { fetchVocabulary, removeVocabulary } from "../api/vocabulary";
import ConfirmModal from "../components/ui/ConfirmModal";

const PAGE_SIZE = 10;

export default function VocabularyPage() {
  const [words, setWords] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sort, setSort] = useState("recent");
  const [groupBy, setGroupBy] = useState("none");
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wordToDelete, setWordToDelete] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchQuery); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const loadVocabulary = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await fetchVocabulary({ page, limit: PAGE_SIZE, sort, search });
      setWords(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      setError(err.message || "Unable to load vocabulary.");
    } finally {
      setLoading(false);
    }
  }, [page, search, sort]);

  useEffect(() => { loadVocabulary(); }, [loadVocabulary]);

  useEffect(() => {
    if (totalPages > page) fetchVocabulary({ page: page + 1, limit: PAGE_SIZE, sort, search }).catch(() => {});
    if (page > 1) fetchVocabulary({ page: page - 1, limit: PAGE_SIZE, sort, search }).catch(() => {});
  }, [page, totalPages, sort, search]);

  async function removeWord(word) {
    try {
      setError("");
      await removeVocabulary(word);
      setWordToDelete(null);
      if (words.length === 1 && page > 1) {
        setPage((value) => value - 1);
      } else {
        loadVocabulary();
      }
    } catch (err) {
      setError(err.message || "Unable to remove word.");
    }
  }

  function changeSort(nextSort) { setSort(nextSort); setPage(1); }
  function changeGroup(nextGroup) { setGroupBy(nextGroup); setPage(1); }

  // Group words by article for display (only when groupBy === "article")
  const articleGroups = useMemo(() => {
    if (groupBy !== "article") return [];
    const groups = new Map();
    words.forEach((item) => {
      const key = item.article_id || item.sourceArticleTitle || "unlinked";
      if (!groups.has(key)) {
        groups.set(key, { title: item.sourceArticleTitle || "Unlinked / Other", items: [] });
      }
      groups.get(key).items.push(item);
    });
    const orderedGroups = [...groups.values()].sort((a, b) => {
      if (a.title === "Unlinked / Other") return 1;
      if (b.title === "Unlinked / Other") return -1;
      return a.title.localeCompare(b.title);
    });
    return orderedGroups;
  }, [words, groupBy]);

  const currentPage = page;
  const currentTotalPages = totalPages;

  function goToPreviousPage() {
    setPage((value) => Math.max(1, value - 1));
  }

  function goToNextPage() {
    setPage((value) => Math.min(totalPages, value + 1));
  }

  return <section className="vocabulary-page">
    <div className="vocabulary-header"><div><p className="eyebrow">Your saved words</p><h2>Vocabulary</h2></div><div className="vocabulary-pagination"><span className="vocabulary-count">{groupBy === "article" ? `${articleGroups.length} ${articleGroups.length === 1 ? "article" : "articles"} · ` : ""}{total} {total === 1 ? "word" : "words"}</span><button type="button" className="vocabulary-page-button" onClick={goToPreviousPage} disabled={currentPage <= 1} aria-label="Previous page"><ChevronLeft size={17} /></button><button type="button" className="vocabulary-page-button" onClick={goToNextPage} disabled={currentPage >= currentTotalPages} aria-label="Next page"><ChevronRight size={17} /></button></div></div>
    <div className="vocabulary-controls"><div className="vocabulary-search"><Search size={18} /><input type="text" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search words..." aria-label="Search vocabulary" />{searchQuery && <button type="button" className="search-clear" onClick={() => setSearchQuery("")} aria-label="Clear search"><X size={15} /></button>}</div><div className="vocabulary-sort" aria-label="Sort vocabulary"><button type="button" className={sort === "recent" ? "is-active" : ""} onClick={() => changeSort("recent")}>Recently Added</button><button type="button" className={sort === "az" ? "is-active" : ""} onClick={() => changeSort("az")}>A-Z</button></div><label className="vocabulary-group-control">Group<select value={groupBy} onChange={(event) => changeGroup(event.target.value)} aria-label="Group vocabulary"><option value="none">None</option><option value="article">By Article</option></select></label></div>
    {loading && !words.length && <p className="side-message">Loading vocabulary...</p>}
    {error && <p className="error-message">{error}</p>}
    {!loading && !error && total === 0 && <p className="empty-vocabulary">{search ? `No words match “${search}”.` : "No saved words yet. Look up a word in the reader, then save it here."}</p>}
    {groupBy === "article" && articleGroups.length > 0 && <div className="article-vocabulary-groups">{articleGroups.map((group) => <section className="article-vocabulary-group" key={group.title}><header className="article-vocabulary-group__header"><strong>{group.title}</strong><span>{group.items.length} {group.items.length === 1 ? "word" : "words"}</span></header><div className="vocabulary-list">{group.items.map((item) => <article className="vocabulary-item" key={item.word.toLowerCase()}><div className="vocabulary-word-content"><div className="vocabulary-word-row"><h3>{item.word}</h3>{item.phonetic && <span className="phonetic">{item.phonetic}</span>}</div><p className="vocabulary-definition">{item.definition || item.definitions?.[0] || "No definition available."}</p><small>Saved {new Date(item.savedAt).toLocaleDateString()}</small></div><button className="icon-button vocabulary-delete-button" onClick={() => setWordToDelete(item.word)} aria-label={`Remove ${item.word}`}><Trash2 size={17} /></button></article>)}</div></section>)}</div>}
    {groupBy === "none" && words.length > 0 && <div className="vocabulary-list">{words.map((item) => <article className="vocabulary-item" key={item.word.toLowerCase()}><div className="vocabulary-word-content"><div className="vocabulary-word-row"><h3>{item.word}</h3>{item.phonetic && <span className="phonetic">{item.phonetic}</span>}</div><p className="vocabulary-definition">{item.definition || item.definitions?.[0] || "No definition available."}</p>{item.sourceArticleTitle && <small>From: {item.sourceArticleTitle}</small>}<small>Saved {new Date(item.savedAt).toLocaleDateString()}</small></div><button className="icon-button vocabulary-delete-button" onClick={() => setWordToDelete(item.word)} aria-label={`Remove ${item.word}`}><Trash2 size={17} /></button></article>)}</div>}
    <ConfirmModal open={wordToDelete !== null} title="Remove saved word?" message={<>Are you sure you want to remove <strong>"{wordToDelete}"</strong>?</>} onCancel={() => setWordToDelete(null)} onConfirm={() => removeWord(wordToDelete)} />
  </section>;
}