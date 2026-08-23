import { useCallback, useEffect, useRef } from "react";
import { safeGetItem, safeSetItem, safeRemoveItem } from "../utils/storage";

const PREFIX = "deep-read-draft";
const SAVE_DEBOUNCE = 1500;

export default function useDraft(articleId) {
  const tempIdRef = useRef(null);
  const saveTimerRef = useRef(null);
  const prevArticleIdRef = useRef(articleId);

  /* ---------- key helpers ---------- */

  function getTempId() {
    if (!tempIdRef.current) tempIdRef.current = crypto.randomUUID();
    return tempIdRef.current;
  }

  function getKey() {
    if (articleId) return `${PREFIX}-${articleId}`;
    return `${PREFIX}-temp-${getTempId()}`;
  }

  /* ---------- public API ---------- */

  /** Read draft from localStorage. Returns { blocks, title, savedAt } or null. */
  const readDraft = useCallback(() => {
    try {
      const raw = safeGetItem(getKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.savedAt) return parsed;
      return null;
    } catch {
      return null;
    }
  }, [articleId]);

  /** Debounced save of blocks + title to localStorage. */
  const saveDraft = useCallback(
    (blocks, title) => {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const key = getKey();
        safeSetItem(key, JSON.stringify({ blocks, title, savedAt: Date.now() }));
      }, SAVE_DEBOUNCE);
    },
    [articleId]
  );

  /** Remove current draft key, its temp variant, and the legacy null key. */
  const clearDraft = useCallback(() => {
    safeRemoveItem(getKey());
    if (tempIdRef.current) {
      safeRemoveItem(`${PREFIX}-temp-${tempIdRef.current}`);
    }
    // Clean up legacy broken key from old code
    safeRemoveItem(`${PREFIX}-null`);
  }, [articleId]);

  /** Compare draft.savedAt vs serverUpdatedAt. Returns true if draft should be restored. */
  const isDraftNewer = useCallback(
    (serverUpdatedAt) => {
      const draft = readDraft();
      if (!draft?.savedAt) return false;
      if (!serverUpdatedAt) return false; // No server timestamp → don't assume draft is newer
      const serverTime = new Date(serverUpdatedAt).getTime();
      return Number.isFinite(serverTime) && draft.savedAt > serverTime;
    },
    [articleId]
  );

  /* ---------- lifecycle ---------- */

  // Migrate temp draft to real article key when articleId transitions from falsy → truthy
  useEffect(() => {
    const prev = prevArticleIdRef.current;
    prevArticleIdRef.current = articleId;

    if (!prev && articleId && tempIdRef.current) {
      const tempKey = `${PREFIX}-temp-${tempIdRef.current}`;
      const realKey = `${PREFIX}-${articleId}`;
      const data = safeGetItem(tempKey);
      if (data) {
        safeSetItem(realKey, data);
        safeRemoveItem(tempKey);
      }
    }
  }, [articleId]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current);
  }, []);

  return { readDraft, saveDraft, clearDraft, isDraftNewer };
}