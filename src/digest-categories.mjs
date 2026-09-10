export const HOT_CATEGORY = '重要动态';
export const FEATURED_CATEGORY = '精选资讯';
export const MAX_HOT_ITEMS = 4;
export const MIN_DIGEST_ITEMS = 8;

const normalizeItemUrl = (url) => {
  try {
    const parsed = new URL(String(url || '').trim());
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
};

export function normalizeCategory(category) {
  return String(category || '').trim() === HOT_CATEGORY ? HOT_CATEGORY : FEATURED_CATEGORY;
}

export function isHotItem(item) {
  return normalizeCategory(item?.category) === HOT_CATEGORY;
}

export function normalizeDigestCategories(items, { maxHot = MAX_HOT_ITEMS } = {}) {
  if (!Array.isArray(items)) return [];

  let remainingHot = Math.max(0, maxHot);
  return items.map((item) => {
    const next = { ...item, category: normalizeCategory(item?.category) };
    if (next.category === HOT_CATEGORY && remainingHot > 0) {
      remainingHot -= 1;
      return next;
    }
    return { ...next, category: FEATURED_CATEGORY };
  });
}

export function mergeFeaturedFallback(primary = [], fallback = [], { minCount = MIN_DIGEST_ITEMS } = {}) {
  const items = [...primary];
  const seen = new Set(items.map((item) => normalizeItemUrl(item?.url)).filter(Boolean));
  for (const item of fallback) {
    if (items.length >= minCount) break;
    const key = normalizeItemUrl(item?.url);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    items.push({ ...item, category: FEATURED_CATEGORY });
  }
  return items;
}

export function filterItemsBySourceIds(items, sourceIds) {
  const allowed = new Set((sourceIds || []).map((id) => Number(id)).filter(Boolean));
  if (!allowed.size) return [];
  return (items || []).filter((item) => allowed.has(Number(item?.sourceId)));
}

export function filterPublicItems(items) {
  return (items || []).filter((item) => item?.isPublic !== false && item?.isPublic !== 0);
}
