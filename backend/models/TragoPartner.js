const { createModel } = require('../lib/supabaseModel');

const TragoPartner = createModel({
  name: 'TragoPartner',
  table: 'trago_partners',
  collection: 'trago_partners',
  mapping: {
    _id: 'id',
    id: 'id',
    restaurant_id: 'restaurant_id',
    name: 'name',
    partner_type: 'partner_type',
    summary: 'summary',
    products_summary: 'products_summary',
    phone: 'phone',
    whatsapp: 'whatsapp',
    email: 'email',
    address_text: 'address_text',
    address_coords: 'address_coords',
    logo_url: 'logo_url',
    cover_url: 'cover_url',
    opening_hours: 'opening_hours',
    status: 'status',
    source: 'source',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    partner_type: 'other',
    summary: '',
    products_summary: '',
    phone: '',
    whatsapp: '',
    email: '',
    address_text: '',
    logo_url: '',
    cover_url: '',
    opening_hours: '',
    status: 'pending',
    source: 'application'
  }
});

module.exports = TragoPartner;
