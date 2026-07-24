const { createModel } = require('../lib/supabaseModel');

const Restaurant = createModel({
  name: 'Restaurant',
  table: 'restaurants',
  collection: 'restaurants',
  mapping: {
    _id: 'id',
    id: 'id',
    name: 'name',
    email: 'email',
    phone: 'phone',
    password_hash: 'password_hash',
    address_text: 'address_text',
    address_coords: 'address_coords',
    logo_url: 'logo_url',
    cover_url: 'cover_url',
    operational_note: 'operational_note',
    whatsapp: 'whatsapp',
    description: 'description',
    opening_hours: 'opening_hours',
    business_type: 'business_type',
    delivery_time: 'delivery_time',
    is_open: 'is_open',
    status: 'status',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    phone: '',
    address_text: '',
    logo_url: '',
    cover_url: '',
    operational_note: '',
    whatsapp: '',
    description: '',
    opening_hours: '',
    business_type: 'restaurant',
    delivery_time: '',
    is_open: true,
    status: 'active'
  }
});

module.exports = Restaurant;
