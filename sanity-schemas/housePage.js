// Sanity schema: The House Page (singleton)
export default {
  name: 'housePage',
  title: 'The House Page',
  type: 'document',
  fields: [
    { name: 'heroHeadline', title: 'Hero Headline', type: 'string' },
    { name: 'showcaseImage', title: 'Showcase Infographic Image', type: 'image', options: { hotspot: true } },
    {
      name: 'dubaiAtelier', title: 'Dubai Atelier Section', type: 'object',
      fields: [
        { name: 'eyebrow', type: 'string', title: 'Eyebrow' },
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 4 },
        { name: 'image', type: 'image', title: 'Section Image', options: { hotspot: true } }
      ]
    },
    {
      name: 'promiseWords', title: 'Our Promise — 4 Words', type: 'array',
      of: [{ type: 'string' }],
      validation: R => R.max(4).min(4)
    },
    {
      name: 'valuesGrid', title: 'Values Grid (Restraint / Intensity / Continuity)', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'title', type: 'string', title: 'Title' },
          { name: 'body', type: 'text', title: 'Body Text', rows: 2 }
        ]
      }]
    }
  ]
}
