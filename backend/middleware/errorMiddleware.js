const notFound = (req, res, next) => {
  const error = new Error(`Não encontrado - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : Number(err.statusCode || err.status || 500);

  const response = {
    message: err.message || 'Erro interno do servidor'
  };

  if (err.errors) {
    response.errors = err.errors;
  }

  if (process.env.NODE_ENV !== 'production') {
    response.stack = err.stack;
  }

  console.error(`[Erro] ${err.message}`);
  if (err.stack) console.error(err.stack);

  res.status(statusCode).json(response);
};

module.exports = {
  notFound,
  errorHandler
};
