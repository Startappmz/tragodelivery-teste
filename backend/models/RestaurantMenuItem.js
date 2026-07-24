const { createModel } = require('../lib/supabaseModel');

const RestaurantMenuItem = createModel({
  name: 'RestaurantMenuItem',
  table: 'restaurant_menu_items',
  collection: 'restaurant_menu_items',
  mapping: {
    _id: 'id',
    id: 'id',
    restaurant_id: 'restaurant_id',
    restaurant: 'restaurant_id',
    name: 'name',
    category: 'category',
    description: 'description',
    price: 'price',
    image_url: 'image_url',
    available: 'available',
    prep_time_min: 'prep_time_min',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    category: 'Geral',
    description: '',
    price: 0,
    image_url: '',
    available: true,
    prep_time_min: null
  }
});

module.exports = RestaurantMenuItem;
