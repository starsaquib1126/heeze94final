// Sanity schema: Product Content (editorial text/images only)
// IMPORTANT: price, stock, and sizes live in Supabase, NOT here — this only
// holds the marketing description and imagery. The 'productSlug' field must
// exactly match the product's slug in Supabase (e.g. 'black-oud') so the
// site can join the two together.
export default {
  name: 'productContent',
  title: 'Product Content',
  type: 'document',
  fields: [
    {
      name: 'productSlug', title: 'Product Slug (must match Supabase exactly)', type: 'string',
      description: 'e.g. black-oud, golden-oud, rose-musk, arabian-nights, al-durrah',
      validation: R => R.required()
    },
    {
      name: 'status', title: 'Status', type: 'string',
      description: 'Controls how this product appears on the live site.',
      options: {
        list: [
          { title: 'Active — buyable now', value: 'active' },
          { title: 'Coming Soon — shown, no purchase', value: 'coming_soon' },
          { title: 'Sold Out — shown, disabled', value: 'sold_out' },
          { title: 'Hidden — not shown on site', value: 'hidden' }
        ],
        layout: 'radio'
      },
      initialValue: 'active',
      validation: R => R.required()
    },
    { name: 'displayName', title: 'Display Name', type: 'string' },
    { name: 'shortDescription', title: 'Short Description (used in listings)', type: 'text', rows: 2 },
    { name: 'fullDescription', title: 'Full Description (used on product detail page)', type: 'array', of: [{ type: 'block' }] },
    { name: 'heroImage', title: 'Hero Image', type: 'image', options: { hotspot: true } },
    { name: 'gallery', title: 'Additional Gallery Images', type: 'array', of: [{ type: 'image', options: { hotspot: true } }] }
  ]
}
