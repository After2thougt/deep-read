import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Trash2, X } from "lucide-react";
import { fetchVocabulary, removeVocabulary } from "../api/vocabulary";
import ConfirmModal from "../components/ConfirmModal";

const PAGE_SIZE = 10;

export default function VocabularyPage() {
  const [words, setWords] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sort, setSort] = useState("recent");
  const [groupBy, setGroupBy] = useState("none");
  const [articleGroups, setArticleGroups] = useState([]);
  const [groupPage, setGroupPage] = useState(1);
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
      setLoading(true); setError("");
      if (groupBy === "article") {
        const first = await fetchVocabulary({ page: 1, limit: 50, sort, search });
        const allItems = [...first.items];
        for (let nextPage = 2; nextPage <= first.totalPages; nextPage += 1) {
          const result = await fetchVocabulary({ page: nextPage, limit: 50, sort, search });
          allItems.push(...result.items);
        }
        const groups = new Map();
        allItems.forEach((item) => {
          const key = item.article_id || item.sourceArticleTitle || "unlinked";
          if (!groups.has(key)) groups.set(key, { title: item.sourceArticleTitle || "Unlinked / Other", items: [] });
          groups.get(key).items.push(item);
        });
        const orderedGroups = [...groups.values()].sort((a, b) => a.title === "Unlinked / Other" ? 1 : b.title === "Unlinked / Other" ? -1 : a.title.localeCompare(b.title));
        setArticleGroups(orderedGroups);
        setTotal(allItems.length); setTotalPages(Math.max(1, first.totalPages)); setGroupPage(1); setWords([]);
        return;
      }
      const result = await fetchVocabulary({ page, limit: PAGE_SIZE, sort, search });
      setWords(result.items); setTotal(result.total); setTotalPages(result.totalPages);
    } catch (err) { setError(err.message || "Unable to load vocabulary."); }
    finally { setLoading(false); }
  }, [groupBy, page, search, sort]);

  useEffect(() => { loadVocabulary(); }, [loadVocabulary]);

  useEffect(() => {
    if (groupBy === "article") return;
    if (totalPages > page) fetchVocabulary({ page: page + 1, limit: PAGE_SIZE, sort, search }).catch(() => {});
    if (page > 1) fetchVocabulary({ page: page - 1, limit: PAGE_SIZE, sort, search }).catch(() => {});
  }, [groupBy, page, totalPages, sort, search]);

  async function removeWord(word) {
    try {
      setError(""); await removeVocabulary(word); setWordToDelete(null);
      if (groupBy === "article") loadVocabulary();
      else if (words.length === 1 && page > 1) setPage((value) => value - 1); else loadVocabulary();
    } catch (err) { setError(err.message || "Unable to remove word."); }
  }
  function changeSort(nextSort) { setSort(nextSort); setPage(1); }
  function changeGroup(nextGroup) { setGroupBy(nextGroup); setPage(1); setGroupPage(1); }

  const visibleGroups = articleGroups.slice((groupPage - 1) * 3, groupPage * 3);
  const groupTotalPages = Math.max(1, Math.ceil(articleGroups.length / 3));

  return <section className="vocabulary-page">
    <div className="vocabulary-header"><div><p className="eyebrow">Your saved words</p><h2>Vocabulary</h2></div><div className="vocabulary-pagination"><span className="vocabulary-count">{total} {total === 1 ? "word" : "words  "}</span><button type="button" className="vocabulary-page-button" onClick={() => setPage((value) => value - 1)} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={17} /></button><button type="button" className="vocabulary-page-button" onClick={() => setPage((value) => value + 1)} disabled={page === totalPages} aria-label="Next page"><ChevronRight size={17} /></button></div></div>
    <div className="vocabulary-controls"><div className="vocabulary-search"><Search size={18} /><input type="text" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search words..." aria-label="Search vocabulary" />{searchQuery && <button type="button" className="search-clear" onClick={() => setSearchQuery("")} aria-label="Clear search"><X size={15} /></button>}</div><div className="vocabulary-sort" aria-label="Sort vocabulary"><button type="button" className={sort === "recent" ? "is-active" : ""} onClick={() => changeSort("recent")}>Recently Added</button><button type="button" className={sort === "az" ? "is-active" : ""} onClick={() => changeSort("az")}>A-Z</button></div><label className="vocabulary-group-control">Group<select value={groupBy} onChange={(event) => changeGroup(event.target.value)} aria-label="Group vocabulary"><option value="none">None</option><option value="article">By Article</option></select></label></div>
    {loading && !words.length && <p className="side-message">Loading vocabulary...</p>}
    {error && <p className="error-message">{error}</p>}
    {!loading && !error && total === 0 && <p className="empty-vocabulary">{search ? `No words match “${search}”.` : "No saved words yet. Look up a word in the reader, then save it here."}</p>}
    {groupBy === "article" && articleGroups.length > 0 && <div className="article-vocabulary-groups">{visibleGroups.map((group) => <section className="article-vocabulary-group" key={group.title}><header className="article-vocabulary-group__header"><strong>{group.title}</strong><span>{group.items.length} {group.items.length === 1 ? "word" : "words"}</span></header><div className="vocabulary-list">{group.items.map((item) => <article className="vocabulary-item" key={item.word.toLowerCase()}><div className="vocabulary-word-content"><div className="vocabulary-word-row"><h3>{item.word}</h3>{item.phonetic && <span className="phonetic">{item.phonetic}</span>}</div><p className="vocabulary-definition">{item.definition || item.definitions?.[0] || "No definition available."}</p><small>Saved {new Date(item.savedAt).toLocaleDateString()}</small></div><button className="icon-button vocabulary-delete-button" onClick={() => setWordToDelete(item.word)} aria-label={`Remove ${item.word}`}><Trash2 size={17} /></button></article>)}</div></section>)}</div>}
    {groupBy === "none" && words.length > 0 && <div className="vocabulary-list">{words.map((item) => <article className="vocabulary-item" key={item.word.toLowerCase()}><div className="vocabulary-word-content"><div className="vocabulary-word-row"><h3>{item.word}</h3>{item.phonetic && <span className="phonetic">{item.phonetic}</span>}</div><p className="vocabulary-definition">{item.definition || item.definitions?.[0] || "No definition available."}</p>{item.sourceArticleTitle && <small>From: {item.sourceArticleTitle}</small>}<small>Saved {new Date(item.savedAt).toLocaleDateString()}</small></div><button className="icon-button vocabulary-delete-button" onClick={() => setWordToDelete(item.word)} aria-label={`Remove ${item.word}`}><Trash2 size={17} /></button></article>)}</div>}
    {groupBy === "article" && groupTotalPages > 1 && <div className="list-pagination"><button type="button" className="vocabulary-page-button" onClick={() => setGroupPage((value) => value - 1)} disabled={groupPage === 1} aria-label="Previous article groups"><ChevronLeft size={17} /></button><span>Group page {groupPage} of {groupTotalPages}</span><button type="button" className="vocabulary-page-button" onClick={() => setGroupPage((value) => value + 1)} disabled={groupPage === groupTotalPages} aria-label="Next article groups"><ChevronRight size={17} /></button></div>}
    <ConfirmModal open={wordToDelete !== null} title="Delete word?" message={<>Are you sure you want to delete <strong>"{wordToDelete}"</strong>?</>} onCancel={() => setWordToDelete(null)} onConfirm={() => removeWord(wordToDelete)} />
  </section>;
}
