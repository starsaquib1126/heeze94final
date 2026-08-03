// Sanity schema: Contact Info (singleton — email, phone, socials, address)
export default {
  name: 'contactInfo',
  title: 'Contact Info',
  type: 'document',
  fields: [
    { name: 'email', title: 'Business Email', type: 'string' },
    { name: 'phone', title: 'Phone / WhatsApp Number (with country code, e.g. +919643391003)', type: 'string' },
    { name: 'instagramHandle', title: 'Instagram Handle (e.g. @heeze.94)', type: 'string' },
    { name: 'instagramUrl', title: 'Instagram Profile URL', type: 'string' },
    { name: 'facebookUrl', title: 'Facebook Page URL', type: 'string' },
    { name: 'address', title: 'Physical / Office Address', type: 'text', rows: 3 }
  ]
}
