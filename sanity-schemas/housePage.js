// Sanity schema: The House Page (singleton)
export default {
  name: 'housePage',
  title: 'The House Page',
  type: 'document',
  fields: [
    { name: 'heroHeadline', title: 'Hero Headline', type: 'string' },
    { name: 'heroSubtext', title: 'Hero Subtext', type: 'text', rows: 3 },
    {
      name: 'ourStory', title: 'Our Story Section', type: 'object',
      fields: [
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 5 }
      ]
    },
    {
      name: 'philosophy', title: 'Our Philosophy — 4 Values', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'word', type: 'string', title: 'Word (e.g. Harmony)' },
          { name: 'body', type: 'text', title: 'Body Text', rows: 2 }
        ]
      }],
      validation: R => R.max(4).min(4)
    },
    {
      name: 'ourOrigin', title: 'Our Origin Section', type: 'object',
      fields: [
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 5 },
        { name: 'image', type: 'image', title: 'Section Image', options: { hotspot: true } }
      ]
    },
    {
      name: 'attarSection', title: 'Attar Section', type: 'object',
      fields: [
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 3 },
        {
          name: 'features', title: 'Feature List', type: 'array',
          of: [{
            type: 'object',
            fields: [
              { name: 'title', type: 'string', title: 'Feature Title' },
              { name: 'subtitle', type: 'string', title: 'Feature Subtitle' }
            ]
          }]
        }
      ]
    },
    {
      name: 'parfumSection', title: 'Parfum Section', type: 'object',
      fields: [
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 3 },
        {
          name: 'features', title: 'Feature List', type: 'array',
          of: [{
            type: 'object',
            fields: [
              { name: 'title', type: 'string', title: 'Feature Title' },
              { name: 'subtitle', type: 'string', title: 'Feature Subtitle' }
            ]
          }]
        }
      ]
    },
    {
      name: 'craftsmanshipJourney', title: 'Craftsmanship Journey — 6 Stages', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'stageName', type: 'string', title: 'Stage Name' },
          { name: 'body', type: 'text', title: 'Description', rows: 2 },
          { name: 'image', type: 'image', title: 'Stage Image', options: { hotspot: true } }
        ]
      }],
      validation: R => R.max(6).min(6)
    },
    {
      name: 'closingStatement', title: 'Closing Statement Section', type: 'object',
      fields: [
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 3 }
      ]
    }
  ]
}
