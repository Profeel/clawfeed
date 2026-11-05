import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURED_CATEGORY,
  HOT_CATEGORY,
  filterItemsBySourceIds,
  filterPublicItems,
  isHotItem,
  mergeFeaturedFallback,
  normalizeCategory,
  normalizeDigestCategories,
} from '../src/digest-categories.mjs';

test('unknown or empty category becomes featured news', () => {
  assert.equal(normalizeCategory('精选资讯'), FEATURED_CATEGORY);
  assert.equal(normalizeCategory(''), FEATURED_CATEGORY);
  assert.equal(normalizeCategory('Important'), FEATURED_CATEGORY);
  assert.equal(normalizeCategory('重要动态 | 精选资讯'), FEATURED_CATEGORY);
  assert.equal(normalizeCategory(' 重要动态 '), HOT_CATEGORY);
});

test('caps important news at four and demotes the rest', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({
    title: `item-${i + 1}`,
    category: HOT_CATEGORY,
  }));

  const normalized = normalizeDigestCategories(items);

  assert.deepEqual(normalized.map((item) => item.category), [
    HOT_CATEGORY,
    HOT_CATEGORY,
    HOT_CATEGORY,
    HOT_CATEGORY,
    FEATURED_CATEGORY,
    FEATURED_CATEGORY,
  ]);
  assert.equal(normalized.filter(isHotItem).length, 4);
});

test('keeps a mix of important and featured items in original order', () => {
  const normalized = normalizeDigestCategories([
    { title: 'a', category: HOT_CATEGORY },
    { title: 'b', category: FEATURED_CATEGORY },
    { title: 'c', category: HOT_CATEGORY },
    { title: 'd' },
    { title: 'e', category: HOT_CATEGORY },
  ]);

  assert.deepEqual(normalized.map((item) => [item.title, item.category]), [
    ['a', HOT_CATEGORY],
    ['b', FEATURED_CATEGORY],
    ['c', HOT_CATEGORY],
    ['d', FEATURED_CATEGORY],
    ['e', HOT_CATEGORY],
  ]);
});

test('pads a short all-hot digest with featured fallback items', () => {
  const merged = mergeFeaturedFallback(
    [
      { title: 'hot-1', url: 'https://a.example/1', category: HOT_CATEGORY },
      { title: 'hot-2', url: 'https://a.example/2', category: HOT_CATEGORY },
    ],
    [
      { title: 'hot-1', url: 'https://a.example/1', category: HOT_CATEGORY },
      { title: 'more-1', url: 'https://b.example/1', category: HOT_CATEGORY },
      { title: 'more-2', url: 'https://b.example/2', category: HOT_CATEGORY },
      { title: 'more-3', url: 'https://b.example/3', category: HOT_CATEGORY },
      { title: 'more-4', url: 'https://b.example/4', category: HOT_CATEGORY },
      { title: 'more-5', url: 'https://b.example/5', category: HOT_CATEGORY },
      { title: 'more-6', url: 'https://b.example/6', category: HOT_CATEGORY },
    ],
    { minCount: 8 },
  );

  assert.equal(merged.length, 8);
  assert.equal(merged[0].category, HOT_CATEGORY);
  assert.ok(merged.slice(2).every((item) => item.category === FEATURED_CATEGORY));
});

test('filters Feishu fan-out items by source id and public flag', () => {
  const items = [
    { title: 'public', sourceId: 1, isPublic: true },
    { title: 'private', sourceId: 2, isPublic: false },
    { title: 'other', sourceId: 3, isPublic: true },
  ];
  assert.deepEqual(filterPublicItems(items).map((item) => item.title), ['public', 'other']);
  assert.deepEqual(filterItemsBySourceIds(items, [2, 3]).map((item) => item.title), ['private', 'other']);
  assert.deepEqual(filterItemsBySourceIds(items, []), []);
});
