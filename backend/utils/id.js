const ID_REGEX = /^[a-f0-9]{24}$/i;

const isValidId = (value) => typeof value === 'string' && ID_REGEX.test(value);
const normalizeId = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  if (typeof value === 'object' && value.id) return String(value.id);
  return String(value);
};

module.exports = { isValidId, normalizeId };
