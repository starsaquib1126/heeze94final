// Sanity schema: Film (one document per video on the Films page)
export default {
  name: 'filmVideo',
  title: 'Film',
  type: 'document',
  fields: [
    { name: 'order', title: 'Display Order (1, 2, 3...)', type: 'number', validation: R => R.required() },
    { name: 'category', title: 'Category Label (e.g. "Parfum · Product Study")', type: 'string' },
    { name: 'title', title: 'Title (e.g. "Warm Light")', type: 'string' },
    {
      name: 'videoFileName', title: 'Video File Name', type: 'string',
      description: 'The exact file name already uploaded to assets/video/ on the website (e.g. "product-12.mp4"). To use a different video, first ask for that file to be uploaded to the site, then type its name here.'
    },
    { name: 'posterImage', title: 'Poster / Thumbnail Image', type: 'image', options: { hotspot: true } }
  ],
  orderings: [
    { title: 'Display Order', name: 'orderAsc', by: [{ field: 'order', direction: 'asc' }] }
  ]
}
