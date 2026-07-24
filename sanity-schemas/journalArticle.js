// Sanity schema: Journal Article
// One document per article — Attar/Perfume/Structure guides, and any future ones.
export default {
  name: 'journalArticle',
  title: 'Journal Article',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: R => R.required() },
    { name: 'slug', title: 'URL Slug', type: 'slug', options: { source: 'title' }, validation: R => R.required() },
    {
      name: 'category', title: 'Category', type: 'string',
      options: { list: ['Guide · Attar', 'Guide · Perfume', 'Guide · Structure', 'Essay', 'Material', 'Ritual'] }
    },
    { name: 'readTime', title: 'Read Time (e.g. "6 min read")', type: 'string' },
    { name: 'excerpt', title: 'Short Excerpt (shown in the feed)', type: 'text', rows: 3 },
    { name: 'heroImage', title: 'Hero Image', type: 'image', options: { hotspot: true } },
    { name: 'body', title: 'Full Article Body', type: 'array', of: [{ type: 'block' }] },
    { name: 'publishedAt', title: 'Published Date', type: 'datetime' }
  ]
}
