const express = require('express');
const controller = require('../controllers/publicPortalController');
const communication = require('../controllers/orderCommunicationController');

const router = express.Router();

router.get('/public/restaurants', controller.listPublicRestaurants);
router.get('/public/partners', controller.listPublicPartners);
router.post('/public/partners/applications', controller.createPublicPartnerApplication);
router.post('/public/geo/quote', controller.createPublicRouteQuote);
router.post('/public/geo/route', controller.createPublicRouteGeometry);
router.post('/public/ratings', controller.createPublicRating);
router.post('/public/clients/register', controller.registerPublicClient);
router.post('/public/clients/google', controller.googleClientAuth);
router.get('/public/geo/search', controller.searchPublicAddresses);
router.get('/public/geo/reverse', controller.reversePublicAddress);
router.post('/public/restaurants/register', controller.registerRestaurant);
router.post('/public/restaurants/login', controller.loginRestaurant);
router.post('/public/orders', controller.createPublicOrder);
router.get('/public/orders/:id/context', communication.getPublicContext);
router.get('/public/orders/:id/messages', communication.listPublicMessages);
router.post('/public/orders/:id/messages', communication.createPublicMessage);
router.post('/public/orders/:id/cancel', communication.cancelPublicOrder);
router.post('/public/orders/:id/radar-assign', controller.assignPublicOrderWithRadar);
router.post('/public/orders/:id/driver-offer', controller.offerPublicOrderToDriver);

router.get('/restaurant/profile', controller.getRestaurantProfile);
router.put('/restaurant/profile', controller.updateRestaurantProfile);
router.get('/restaurant/menu', controller.getRestaurantMenu);
router.post('/restaurant/menu', controller.createRestaurantMenuItem);
router.put('/restaurant/menu/:id', controller.updateRestaurantMenuItem);
router.delete('/restaurant/menu/:id', controller.deleteRestaurantMenuItem);
router.get('/restaurant/orders', controller.getRestaurantOrders);
router.get('/restaurant/orders/:id/messages', controller.restaurantOrderContext, communication.listRestaurantMessages);
router.post('/restaurant/orders/:id/messages', controller.restaurantOrderContext, communication.createRestaurantMessage);
router.post('/restaurant/orders/:id/confirm', controller.restaurantOrderContext, communication.confirmRestaurantOrder);
router.post('/restaurant/orders/:id/pickup-confirmation', controller.restaurantOrderContext, communication.confirmRestaurantPickup);
router.post('/restaurant/orders/:id/status', controller.restaurantOrderContext, communication.updateRestaurantStatus);

module.exports = router;
