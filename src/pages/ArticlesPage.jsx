import { useCallback, useEffect, useState } from "react";
import { ArrowUpDown, BookOpen, Check, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, X as XIcon } from "lucide-react";
import { addArticleTag, clearArticleListCache, createTag, deleteTag, fetchArticle, fetchArticles, removeArticleTag, removeArticle, renameTag } from "../api/articles";
import ConfirmModal from "../components/ui/ConfirmModal";

const PAGE_SIZE = 10;

function ArticleSearchBar({ onSearch, onClear }) {
  const [input, setInput] = useState("");

  function doSearch() {
    const q = input.trim();
    if (q) onSearch(q);
  }

  function doClear() {
    setInput("");
    onClear();
  }

  return (
    <div className="article-search-bar">
      <Search size={18} className="article-search-icon" />
      <input
        type="text"
        className="article-search-input"
        placeholder="Search articles..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
      />
      {input && (
        <button type="button" className="article-search-clear" onClick={doClear} aria-label="Clear search">
          <XIcon size={16} />
        </button>
      )}
      
    </div>
  );
}

function TagPill({ tag, active, onClick, onPrefetch, managing, onRename, onDelete }) {
  return <div className={`tag-pill-wrapper ${managing ? "is-managing" : ""}`}>
    <button type="button" className={`tag-pill ${active ? "is-active" : ""}`} onMouseEnter={onPrefetch} onFocus={onPrefetch} onClick={() => managing ? onRename(tag) : onClick()}>
      {active && !managing && <Check size={13} />}{tag.name}<span>{tag.article_count ?? 0}</span>
    </button>
    {managing && <button type="button" className="tag-delete-button" onClick={() => onDelete(tag)} aria-label={`Delete ${tag.name}`}><XIcon size={12} /></button>}
  </div>;
}

export default function ArticlesPage({
  onOpenArticle,
  refreshVersion = 0,
}) {
  const [articles, setArticles] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [allTotal, setAllTotal] = useState(0);
  const [untaggedTotal, setUntaggedTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [articleToDelete, setArticleToDelete] = useState(null);
  const [editingArticle, setEditingArticle] = useState(null);
  const [managing, setManaging] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState(""); // '' = recently updated (default)

  const loadArticles = useCallback(async () => {
    try {
      setLoading(true); setError("");
      const payload = { page, limit: PAGE_SIZE };
      if (sort) payload.sort = sort;
      if (searchQuery) {
        payload.title = searchQuery;
        payload.tagSearch = searchQuery;
      } else {
        payload.tag = selectedTag;
      }
      const result = await fetchArticles(payload);
      setArticles(result.items); setTags(result.tags || []); setTotal(result.total); setAllTotal(result.allTotal); setUntaggedTotal(result.untaggedTotal); setTotalPages(result.totalPages);
    } catch (err) {
      setError(err.message || "Unable to load articles.");
    } finally { setLoading(false); }
  }, [page, selectedTag, searchQuery, sort]);

  useEffect(() => {
  loadArticles();
}, [loadArticles, refreshVersion]);
  function prefetchTag(tag) {
    fetchArticles({ page: 1, limit: PAGE_SIZE, tag }).catch(() => {});
  }
  function selectTag(tag) { setSelectedTag(tag); setPage(1); }
  function updateArticleTags(articleId, nextTags) {
    setArticles((current) => current.map((article) => article.id === articleId ? { ...article, tags: nextTags } : article));
    setEditingArticle((current) => current?.id === articleId ? { ...current, tags: nextTags } : current);
  }
  async function toggleArticleTag(article, tag) {
    const current = article.tags || []; const exists = current.some((item) => item.id === tag.id);
    try {
      setError("");
      if (exists) await removeArticleTag(article.id, tag.id); else await addArticleTag(article.id, tag.id);
      clearArticleListCache();
      const nextTags = exists ? current.filter((item) => item.id !== tag.id) : [...current, { id: tag.id, name: tag.name }];
      updateArticleTags(article.id, nextTags);
      setTags((all) => all.map((item) => item.id === tag.id ? { ...item, article_count: Math.max(0, Number(item.article_count || 0) + (exists ? -1 : 1)) } : item));
      setUntaggedTotal((value) => value + (current.length === 0 && !exists ? -1 : current.length === 1 && exists ? 1 : 0));
      if (selectedTag === "untagged" || selectedTag === String(tag.id)) loadArticles();
    } catch (err) { setError(err.message || "Unable to update article tags."); }
  }
  async function addTag() {
    const name = newTagName.trim(); if (!name) return setError("Tag name is required.");
    try {
      const tag = await createTag(name); clearArticleListCache(); setTags((current) => [...current, tag].sort((a, b) => a.name.localeCompare(b.name))); setNewTagName("");
      if (editingArticle) await toggleArticleTag(editingArticle, tag);
    } catch (err) { setError(err.message || "Unable to create tag."); }
  }
  async function rename(tag) {
    const name = window.prompt("Rename tag", tag.name)?.trim(); if (!name || name === tag.name) return;
    try {
      const updated = await renameTag(tag.id, name); clearArticleListCache(); setTags((current) => current.map((item) => item.id === tag.id ? { ...item, ...updated } : item));
      setArticles((current) => current.map((article) => ({ ...article, tags: (article.tags || []).map((item) => item.id === tag.id ? { ...item, name } : item) })));
    } catch (err) { setError(err.message || "Unable to rename tag."); }
  }
  async function remove(tag) {
    if (!window.confirm(`Delete tag "${tag.name}"? Articles will be kept.`)) return;
    try {
      await deleteTag(tag.id); clearArticleListCache(); setTags((current) => current.filter((item) => item.id !== tag.id));
      if (selectedTag === String(tag.id)) selectTag("all"); else loadArticles();
    } catch (err) { setError(err.message || "Unable to delete tag."); }
  }
  async function openArticle(article) {
    try { setError(""); onOpenArticle(await fetchArticle(article.id)); }
    catch (err) { setError(err.message || "Unable to open article."); }
  }
  async function deleteArticle(article) {
    try {
      setError(""); await removeArticle(article.id); clearArticleListCache(); setArticleToDelete(null);
      setTags((current) => current.map((tag) => ({ ...tag, article_count: (article.tags || []).some((item) => item.id === tag.id) ? Math.max(0, Number(tag.article_count || 0) - 1) : tag.article_count })));
      if (articles.length === 1 && page > 1) setPage((value) => value - 1); else loadArticles();
    } catch (err) { setError(err.message || "Unable to delete article."); }
  }

  return <section className="articles-page">
    <div><p className="eyebrow">Your reading library</p><h2>Saved Articles</h2></div>

    <div className="article-controls-row">
    <ArticleSearchBar
      onSearch={(q) => { setSearchQuery(q); setPage(1); }}
      onClear={() => { setSearchQuery(""); setPage(1); }}
    />

    <div className="article-sort-row">
      <ArrowUpDown size={16} className="article-sort-icon" />
      <select className="article-sort-select" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
        <option value="">Recently Updated</option>
        <option value="created_desc">Newest Created</option>
        <option value="title_asc">Title A–Z</option>
        <option value="words_desc">Most Words</option>
      </select>
    </div>

    </div>
  
    <div className="tag-toolbar"><div className="tag-filter-scroll">
      <button type="button" className={`tag-filter ${selectedTag === "all" ? "is-active" : ""}`} onMouseEnter={() => prefetchTag("all")} onFocus={() => prefetchTag("all")} onClick={() => selectTag("all")}>All <span>{allTotal}</span></button>
      <button type="button" className={`tag-filter ${selectedTag === "untagged" ? "is-active" : ""}`} onMouseEnter={() => prefetchTag("untagged")} onFocus={() => prefetchTag("untagged")} onClick={() => selectTag("untagged")}>unlabel <span>{untaggedTotal}</span></button>
      {tags.map((tag) => <TagPill key={tag.id} tag={tag} active={selectedTag === String(tag.id)} managing={managing} onClick={() => selectTag(String(tag.id))} onPrefetch={() => prefetchTag(String(tag.id))} onRename={rename} onDelete={remove} />)}
    </div><button className="tag-tool-button" type="button" onClick={() => setManaging((current) => !current)}><Pencil size={15} /></button></div>
    {error && <p className="error-message">{error}</p>}
    {loading && !articles.length && <p className="side-message">Loading articles...</p>}
    {!loading && !articles.length && <p className="empty-vocabulary">{total ? "No articles match this tag." : "No saved articles yet."}</p>}

    {articles.length > 0 && <div className="article-list">{articles.map((article) => <article className="article-list-item" key={article.id}>
      <button className="article-open-button" onClick={() => openArticle(article)}><BookOpen size={20} /><span><strong>{article.title}</strong><small>{Number(article.contentLength || 0).toLocaleString()} characters · Created {new Date(article.createdAt).toLocaleDateString()} · Updated {new Date(article.updatedAt).toLocaleDateString()}</small></span></button>
      <button className="icon-button" onClick={() => setArticleToDelete(article)} aria-label={`Delete ${article.title}`}><Trash2 size={18} /></button>
      <div className="article-tags">{article.tags?.length ? article.tags.map((tag) => <span className="article-tag" key={tag.id}>{tag.name}</span>) : <span className="untagged-label">unlabel</span>}<button type="button" className="add-tag-button" onClick={() => setEditingArticle(article)}>+ Add tag</button></div>
    </article>)}</div>}
    {totalPages > 1 && <div className="list-pagination"><button type="button" className="vocabulary-page-button" onClick={() => setPage((value) => value - 1)} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={17} /></button><span>Page {page} of {totalPages}</span><button type="button" className="vocabulary-page-button" onClick={() => setPage((value) => value + 1)} disabled={page === totalPages} aria-label="Next page"><ChevronRight size={17} /></button></div>}
    {editingArticle && <div className="tag-popover-overlay" onClick={() => setEditingArticle(null)}><div className="tag-popover" onClick={(event) => event.stopPropagation()}><div className="tag-manager-header"><h3>Add tag</h3><button className="icon-button" type="button" onClick={() => setEditingArticle(null)} aria-label="Close"><XIcon size={18} /></button></div>{tags.map((tag) => <button type="button" className={`tag-option ${(editingArticle.tags || []).some((item) => item.id === tag.id) ? "is-selected" : ""}`} key={tag.id} onClick={() => toggleArticleTag(editingArticle, tag)}>{(editingArticle.tags || []).some((item) => item.id === tag.id) ? <Check size={15} /> : <span className="tag-option-empty" />}{tag.name}</button>)}<div className="tag-create-row"><input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="New tag" /><button className="secondary-button" type="button" onClick={addTag}><Plus size={15} />New tag</button></div></div></div>}
    <ConfirmModal open={articleToDelete !== null} title="Delete article?" message={<>Are you sure you want to delete <strong>"{articleToDelete?.title}"</strong>?</>} onCancel={() => setArticleToDelete(null)} onConfirm={() => deleteArticle(articleToDelete)} />
  </section>;
}
