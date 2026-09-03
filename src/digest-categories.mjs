export const HOT_CATEGORY = '重要动态';
export const FEATURED_CATEGORY = '精选资讯';
export const MAX_HOT_ITEMS = 4;

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
