import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURED_CATEGORY,
  HOT_CATEGORY,
  isHotItem,
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
