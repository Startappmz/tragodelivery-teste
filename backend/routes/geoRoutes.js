const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const { buildRouteQuote, buildRouteGeometry } = require('../utils/geoPricing');

const router = express.Router();

router.post('/quote', protect, admin, async (req, res, next) => {
  try {
    const quote = await buildRouteQuote(req.body.origin, req.body.destination);
    res.status(200).json(quote);
  } catch (error) {
    res.status(400);
    next(error);
  }
});

router.post('/route', protect, async (req, res, next) => {
  try {
    const route = await buildRouteGeometry(req.body.origin, req.body.destination);
    res.status(200).json(route);
  } catch (error) {
    res.status(400);
    next(error);
  }
});

module.exports = router;
