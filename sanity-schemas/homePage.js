// Sanity schema: Home Page (singleton — only one of these ever exists)
export default {
  name: 'homePage',
  title: 'Home Page',
  type: 'document',
  fields: [
    { name: 'heroEyebrow', title: 'Hero Eyebrow Text', type: 'string' },
    { name: 'heroHeadline', title: 'Hero Headline', type: 'string' },
    { name: 'heroSubtext', title: 'Hero Subtext (below headline)', type: 'text', rows: 3 },
    { name: 'heroImage', title: 'Hero Background Image', type: 'image', options: { hotspot: true } },
    {
      name: 'duoSection', title: 'One House, Two Expressions Section', type: 'object',
      fields: [
        { name: 'eyebrow', type: 'string', title: 'Eyebrow' },
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 3 },
        { name: 'attarImage', title: 'Attar Card Image', type: 'image', options: { hotspot: true } },
        { name: 'parfumImage', title: 'Parfum Card Image', type: 'image', options: { hotspot: true } }
      ]
    },
    {
      name: 'journalSection', title: 'From the Journal Section', type: 'object',
      fields: [
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 3 },
        { name: 'quote', type: 'string', title: 'Pull Quote' },
        { name: 'image', title: 'Section Image', type: 'image', options: { hotspot: true } }
      ]
    },
    {
      name: 'fourIdeas', title: 'Four Ideas Behind Every Bottle', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'word', type: 'string', title: 'Word (e.g. Harmony)' },
          { name: 'subhead', type: 'string', title: 'Subheading (e.g. Balance over volume)' },
          { name: 'body', type: 'text', title: 'Body Text', rows: 2 }
        ]
      }],
      validation: R => R.max(4).min(4)
    },
    {
      name: 'bespokeTeaser', title: 'Bespoke Teaser Section', type: 'object',
      fields: [
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 2 }
      ]
    }
  ]
}
