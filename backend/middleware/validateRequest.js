const { validationResult, matchedData } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: errors.array()[0].msg,
      errors: errors.array()
    });
  }

  req.filtered = matchedData(req, {
    includeOptionals: true,
    locations: ['body', 'params', 'query']
  });

  return next();
};

module.exports = { validateRequest };