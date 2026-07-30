// Sanity schema: Craftsmanship Page (singleton)
export default {
  name: 'craftsmanshipPage',
  title: 'Craftsmanship Page',
  type: 'document',
  fields: [
    { name: 'heroHeadline', title: 'Hero Headline', type: 'string' },
    { name: 'heroSubtext', title: 'Hero Subtext', type: 'text', rows: 3 },
    {
      name: 'completeJourney', title: '"The Complete Journey" Section', type: 'object',
      fields: [
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'caption', type: 'string', title: 'Image Caption' }
      ]
    },
    {
      name: 'stagesIntro', title: '6 Stages Section Intro', type: 'object',
      fields: [
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 2 }
      ]
    },
    {
      name: 'stages', title: 'The 6 Craftsmanship Stages', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'name', type: 'string', title: 'Stage Name' },
          { name: 'body', type: 'text', title: 'Description', rows: 2 }
        ]
      }],
      validation: R => R.max(6).min(6)
    },
    {
      name: 'parfumJourneyIntro', title: 'Parfum Creation Journey Intro', type: 'object',
      fields: [
        { name: 'headline', type: 'string', title: 'Headline' },
        { name: 'body', type: 'text', title: 'Body Text', rows: 2 },
        { name: 'imageCaption', type: 'string', title: 'Image Caption' }
      ]
    },
    {
      name: 'parfumSteps', title: 'The 5 Parfum Creation Steps', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'name', type: 'string', title: 'Step Name' },
          { name: 'body', type: 'text', title: 'Description', rows: 2 }
        ]
      }],
      validation: R => R.max(5).min(5)
    },
    { name: 'ingredientsHeadline', title: 'Ingredients Section Headline', type: 'string' }
  ]
}
