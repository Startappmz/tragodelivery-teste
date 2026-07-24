const { createModel } = require('../lib/supabaseModel');

const RestaurantRating = createModel({
  name: 'RestaurantRating',
  table: 'restaurant_ratings',
  collection: 'restaurant_ratings',
  mapping: {
    _id: 'id',
    id: 'id',
    restaurant_id: 'restaurant_id',
    menu_item_id: 'menu_item_id',
    customer_session_id: 'customer_session_id',
    rating: 'rating',
    comment: 'comment',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    menu_item_id: '',
    customer_session_id: '',
    rating: 5,
    comment: ''
  }
});

module.exports = RestaurantRating;
