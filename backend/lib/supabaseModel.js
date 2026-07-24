const crypto = require('node:crypto');
const { supabaseRequest } = require('../config/supabase');

const PAGE_SIZE = 1000;
const registry = new Map();

const generateId = () => crypto.randomBytes(12).toString('hex');

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const isDateLike = (value) => {
  if (value instanceof Date) return true;
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && /\d{4}-\d{2}-\d{2}/.test(value);
};

const toComparable = (value, reference) => {
  if (value && typeof value === 'object' && value._id) return String(value._id);
  if (value && typeof value === 'object' && value.id) return String(value.id);
  if (value && typeof value.toString === 'function' && value.constructor?.name === 'ObjectId') return value.toString();

  if (value instanceof Date) return value.getTime();
  if (reference instanceof Date && isDateLike(value)) return new Date(value).getTime();
  if (isDateLike(reference) && isDateLike(value)) return new Date(value).getTime();

  return value;
};

const normalizeId = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  if (typeof value === 'object' && value.id) return String(value.id);
  return String(value);
};

const getByPath = (object, path) => {
  if (!object || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
};

const setByPath = (object, path, value) => {
  const keys = path.split('.');
  let current = object;
  keys.slice(0, -1).forEach((key) => {
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  });
  current[keys[keys.length - 1]] = value;
};

const deleteByPath = (object, path) => {
  const keys = path.split('.');
  let current = object;
  keys.slice(0, -1).forEach((key) => {
    if (!current || typeof current !== 'object') return;
    current = current[key];
  });
  if (current && typeof current === 'object') delete current[keys[keys.length - 1]];
};

const valuesEqual = (left, right) => {
  const normalizedLeft = toComparable(left, right);
  const normalizedRight = toComparable(right, left);

  if (normalizedLeft instanceof Date || normalizedRight instanceof Date) {
    return Number(normalizedLeft) === Number(normalizedRight);
  }

  if (typeof normalizedLeft === 'number' || typeof normalizedRight === 'number') {
    return Number(normalizedLeft) === Number(normalizedRight);
  }

  return String(normalizedLeft) === String(normalizedRight);
};

const compareRange = (left, right, operator) => {
  let a = toComparable(left, right);
  let b = toComparable(right, left);

  if (isDateLike(a) || isDateLike(b)) {
    a = new Date(a).getTime();
    b = new Date(b).getTime();
  }

  if (operator === '$gte') return a >= b;
  if (operator === '$lte') return a <= b;
  if (operator === '$gt') return a > b;
  if (operator === '$lt') return a < b;
  return false;
};

const matchesCondition = (actual, condition) => {
  if (isPlainObject(condition) && Object.keys(condition).some((key) => key.startsWith('$'))) {
    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === '$in') return (expected || []).some((item) => valuesEqual(actual, item));
      if (operator === '$ne') return !valuesEqual(actual, expected);
      if (operator === '$exists') return expected ? actual !== undefined : actual === undefined;
      if (['$gte', '$lte', '$gt', '$lt'].includes(operator)) return compareRange(actual, expected, operator);
      return true;
    });
  }

  return valuesEqual(actual, condition);
};

const matchesFilter = (doc, filter = {}) => {
  if (!filter || !Object.keys(filter).length) return true;

  return Object.entries(filter).every(([key, condition]) => {
    if (key === '_id') return matchesCondition(doc._id, condition);
    const actual = getByPath(doc, key);
    return matchesCondition(actual, condition);
  });
};

const applyUpdate = (doc, update = {}) => {
  if (!update || !Object.keys(update).length) return doc;

  if (update.$set) {
    Object.entries(update.$set).forEach(([key, value]) => setByPath(doc, key, value));
  }

  if (update.$unset) {
    Object.keys(update.$unset).forEach((key) => deleteByPath(doc, key));
  }

  const directEntries = Object.entries(update).filter(([key]) => !key.startsWith('$'));
  directEntries.forEach(([key, value]) => setByPath(doc, key, value));

  return doc;
};

const sortDocuments = (docs, sortSpec) => {
  if (!sortSpec) return docs;

  const entries = typeof sortSpec === 'string'
    ? sortSpec.split(/\s+/).filter(Boolean).map((field) => [field.replace(/^-/, ''), field.startsWith('-') ? -1 : 1])
    : Object.entries(sortSpec);

  return [...docs].sort((a, b) => {
    for (const [field, direction] of entries) {
      const dir = Number(direction) < 0 ? -1 : 1;
      const av = getByPath(a, field);
      const bv = getByPath(b, field);

      if (av === bv) continue;
      if (av == null) return 1;
      if (bv == null) return -1;

      const left = isDateLike(av) ? new Date(av).getTime() : av;
      const right = isDateLike(bv) ? new Date(bv).getTime() : bv;

      if (left > right) return dir;
      if (left < right) return -dir;
    }
    return 0;
  });
};

const parseSelectSpec = (selectSpec) => {
  if (!selectSpec || typeof selectSpec !== 'string') return null;
  const parts = selectSpec.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  if (parts.every((part) => part.startsWith('-'))) {
    return { mode: 'exclude', fields: parts.map((part) => part.slice(1)) };
  }

  if (parts.every((part) => part.startsWith('+'))) {
    return { mode: 'includeHidden', fields: parts.map((part) => part.slice(1)) };
  }

  return {
    mode: 'include',
    fields: parts.map((part) => part.replace(/^\+/, ''))
  };
};

const applySelectToDoc = (doc, selectSpec) => {
  if (!doc || !selectSpec) return doc;
  const parsed = parseSelectSpec(selectSpec);
  if (!parsed || parsed.mode === 'includeHidden') return doc;

  if (parsed.mode === 'exclude') {
    parsed.fields.forEach((field) => delete doc[field]);
    return doc;
  }

  const selected = { _id: doc._id, id: doc.id || doc._id };
  parsed.fields.forEach((field) => {
    if (doc[field] !== undefined) selected[field] = doc[field];
  });
  return selected;
};

const applySelect = (value, selectSpec) => {
  if (!selectSpec) return value;
  if (Array.isArray(value)) return value.map((item) => applySelectToDoc(item, selectSpec));
  return applySelectToDoc(value, selectSpec);
};

const serializeForJson = (value) => JSON.parse(JSON.stringify(value));

class Query {
  constructor(model, filter = {}, options = {}) {
    this.model = model;
    this.filter = filter || {};
    this.single = Boolean(options.single);
    this.sortSpec = null;
    this.limitValue = null;
    this.populateSpecs = [];
    this.selectSpec = null;
    this.leanMode = false;
  }

  sort(sortSpec) {
    this.sortSpec = sortSpec;
    return this;
  }

  limit(limitValue) {
    this.limitValue = Number(limitValue) || null;
    return this;
  }

  populate(pathOrSpec, select) {
    if (typeof pathOrSpec === 'string') {
      this.populateSpecs.push({ path: pathOrSpec, select });
    } else if (pathOrSpec && typeof pathOrSpec === 'object') {
      this.populateSpecs.push(pathOrSpec);
    }
    return this;
  }

  select(selectSpec) {
    this.selectSpec = selectSpec;
    return this;
  }

  lean() {
    this.leanMode = true;
    return this;
  }

  async exec() {
    let docs = await this.model._find(this.filter);
    docs = sortDocuments(docs, this.sortSpec);

    if (this.limitValue) docs = docs.slice(0, this.limitValue);

    let result = this.single ? docs[0] || null : docs;

    for (const populateSpec of this.populateSpecs) {
      result = await this.model._populate(result, populateSpec);
    }

    result = applySelect(result, this.selectSpec);

    if (this.leanMode) return serializeForJson(result);
    return result;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }
}

const createModel = ({ name, table, collection, mapping, defaults = {}, relations = {} }) => {
  const dbToApi = Object.entries(mapping).reduce((acc, [apiField, dbField]) => {
    acc[dbField] = apiField;
    return acc;
  }, {});

  const model = {
    modelName: name,
    table,
    collection,
    mapping,
    relations,

    _fromDb(row) {
      if (!row) return null;
      const doc = {};

      Object.entries(mapping).forEach(([apiField, dbField]) => {
        if (row[dbField] !== undefined) doc[apiField] = row[dbField];
      });

      doc._id = row.id;
      doc.id = row.id;

      return this._attachDocumentMethods(doc);
    },

    _toDb(input = {}, { includeId = true } = {}) {
      const dbRow = {};
      const source = { ...defaults, ...input };

      Object.entries(mapping).forEach(([apiField, dbField]) => {
        if (apiField === '_id' || apiField === 'id') return;
        if (source[apiField] === undefined) return;

        let value = source[apiField];
        if (['user', 'created_by_admin', 'assigned_to_driver', 'client', 'vehicle', 'assignedVehicle', 'cancelledBy', 'createdBy', 'assignedUser', 'assignedClient', 'employee', 'created_by', 'driver', 'order'].includes(apiField)) {
          value = normalizeId(value);
        }

        if (value instanceof Date) value = value.toISOString();
        dbRow[dbField] = value;
      });

      if (includeId) {
        dbRow.id = normalizeId(source._id || source.id) || generateId();
      }

      return dbRow;
    },

    _attachDocumentMethods(doc) {
      if (!doc || typeof doc !== 'object') return doc;
      const self = this;

      Object.defineProperty(doc, 'save', {
        enumerable: false,
        configurable: true,
        value: async function save() {
          const updated = await self._updateById(this._id, this);
          Object.keys(this).forEach((key) => delete this[key]);
          Object.assign(this, updated);
          self._attachDocumentMethods(this);
          return this;
        }
      });

      Object.defineProperty(doc, 'deleteOne', {
        enumerable: false,
        configurable: true,
        value: async function deleteOne() {
          return self._deleteById(this._id);
        }
      });

      Object.defineProperty(doc, 'toObject', {
        enumerable: false,
        configurable: true,
        value: function toObject() {
          return serializeForJson(this);
        }
      });

      return doc;
    },

    async _fetchAllRows() {
      const rows = [];
      let from = 0;

      while (true) {
        const to = from + PAGE_SIZE - 1;
        const page = await supabaseRequest(`/rest/v1/${table}?select=*`, {
          method: 'GET',
          headers: { Range: `${from}-${to}` }
        });

        const current = Array.isArray(page) ? page : [];
        rows.push(...current);
        if (current.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return rows;
    },

    async _find(filter = {}) {
      const rows = await this._fetchAllRows();
      return rows.map((row) => this._fromDb(row)).filter((doc) => matchesFilter(doc, filter));
    },

    async _insert(input) {
      const dbRow = this._toDb(input, { includeId: true });
      const rows = await supabaseRequest(`/rest/v1/${table}`, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(dbRow)
      });
      return this._fromDb(rows?.[0]);
    },

    async _updateById(id, input) {
      const dbRow = this._toDb(input, { includeId: false });
      delete dbRow.id;
      dbRow.updated_at = new Date().toISOString();

      const rows = await supabaseRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(dbRow)
      });
      return this._fromDb(rows?.[0]);
    },

    async _deleteById(id) {
      const rows = await supabaseRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' }
      });
      return rows?.length ? this._fromDb(rows[0]) : null;
    },

    find(filter = {}) {
      return new Query(this, filter, { single: false });
    },

    findOne(filter = {}) {
      return new Query(this, filter, { single: true });
    },

    findById(id) {
      return new Query(this, { _id: normalizeId(id) }, { single: true });
    },

    async create(input) {
      if (Array.isArray(input)) {
        const created = [];
        for (const item of input) created.push(await this._insert(item));
        return created;
      }
      return this._insert(input);
    },

    async insertMany(items = []) {
      const created = [];
      for (const item of items) created.push(await this._insert(item));
      return created;
    },

    async findOneAndUpdate(filter = {}, update = {}, options = {}) {
      let doc = await this.findOne(filter);
      if (!doc && options.upsert) {
        const seed = { ...filter };
        doc = await this.create(applyUpdate(seed, update));
        return doc;
      }
      if (!doc) return null;
      applyUpdate(doc, update);
      return this._updateById(doc._id, doc);
    },

    async findByIdAndUpdate(id, update = {}) {
      const doc = await this.findById(id);
      if (!doc) return null;
      applyUpdate(doc, update);
      return this._updateById(doc._id, doc);
    },

    async findByIdAndDelete(id) {
      return this._deleteById(id);
    },

    async deleteMany(filter = {}) {
      const docs = await this._find(filter);
      let deletedCount = 0;
      for (const doc of docs) {
        await this._deleteById(doc._id);
        deletedCount += 1;
      }
      return { deletedCount };
    },

    async exists(filter = {}) {
      const doc = await this.findOne(filter).lean();
      return doc ? { _id: doc._id } : null;
    },

    async countDocuments(filter = {}) {
      const docs = await this._find(filter);
      return docs.length;
    },

    async aggregate(pipeline = []) {
      let data = (await this._find({})).map((doc) => serializeForJson(doc));

      for (const stage of pipeline) {
        if (stage.$match) {
          data = data.filter((doc) => matchesFilter(doc, stage.$match));
        } else if (stage.$group) {
          data = groupDocuments(data, stage.$group);
        } else if (stage.$sort) {
          data = sortDocuments(data, stage.$sort);
        } else if (stage.$limit) {
          data = data.slice(0, Number(stage.$limit));
        } else if (stage.$lookup) {
          data = await lookupDocuments(data, stage.$lookup);
        } else if (stage.$unwind) {
          data = unwindDocuments(data, stage.$unwind);
        } else if (stage.$project) {
          data = projectDocuments(data, stage.$project);
        }
      }

      return data;
    },

    async _populate(value, populateSpec) {
      if (!value) return value;
      if (Array.isArray(value)) {
        const output = [];
        for (const item of value) output.push(await populateOne(this, item, populateSpec));
        return output;
      }
      return populateOne(this, value, populateSpec);
    }
  };

  registry.set(name, model);
  if (collection) registry.set(collection, model);
  registry.set(table, model);

  return model;
};

const resolveModel = (modelRef) => {
  if (!modelRef) return null;
  if (typeof modelRef === 'function') return modelRef();
  if (typeof modelRef === 'string') return registry.get(modelRef);
  return modelRef;
};

const populateOne = async (sourceModel, doc, populateSpec) => {
  if (!doc) return doc;

  const path = populateSpec.path;
  const relation = sourceModel.relations[path];
  if (!relation) return doc;

  const targetModel = resolveModel(relation.model);
  if (!targetModel) return doc;

  let related;

  if (relation.virtual) {
    related = relation.single
      ? await targetModel.findOne({ [relation.foreignField]: getByPath(doc, relation.localField) })
      : await targetModel.find({ [relation.foreignField]: getByPath(doc, relation.localField) });
  } else {
    const localValue = getByPath(doc, relation.localField || path);
    related = localValue
      ? await targetModel.findOne({ [relation.foreignField || '_id']: localValue })
      : null;
  }

  if (related && populateSpec.populate) {
    related = await targetModel._populate(related, populateSpec.populate);
  }

  if (related && populateSpec.select) {
    related = applySelect(related, populateSpec.select);
  }

  doc[path] = related;
  return doc;
};

const evaluateExpression = (doc, expression) => {
  if (typeof expression === 'number') return expression;
  if (typeof expression === 'string') {
    if (expression.startsWith('$')) return getByPath(doc, expression.slice(1));
    return expression;
  }
  if (expression && expression.$ifNull) {
    const [fieldExpr, fallback] = expression.$ifNull;
    const value = evaluateExpression(doc, fieldExpr);
    return value == null ? fallback : value;
  }
  return expression;
};

const groupDocuments = (docs, groupSpec) => {
  const groups = new Map();

  docs.forEach((doc) => {
    const key = groupSpec._id === null ? null : evaluateExpression(doc, groupSpec._id);
    const groupKey = JSON.stringify(key);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { _id: key });
    }

    const target = groups.get(groupKey);

    Object.entries(groupSpec).forEach(([field, spec]) => {
      if (field === '_id') return;
      if (spec.$sum !== undefined) {
        target[field] = Number(target[field] || 0) + Number(evaluateExpression(doc, spec.$sum) || 0);
      }
    });
  });

  return Array.from(groups.values());
};

const lookupDocuments = async (docs, lookupSpec) => {
  const targetModel = registry.get(lookupSpec.from);
  if (!targetModel) return docs;
  const foreignDocs = await targetModel._find({});

  return docs.map((doc) => {
    const localValue = getByPath(doc, lookupSpec.localField);
    const matches = foreignDocs
      .filter((foreignDoc) => valuesEqual(getByPath(foreignDoc, lookupSpec.foreignField), localValue))
      .map((foreignDoc) => serializeForJson(foreignDoc));
    return { ...doc, [lookupSpec.as]: matches };
  });
};

const unwindDocuments = (docs, unwindSpec) => {
  const path = typeof unwindSpec === 'string' ? unwindSpec.replace(/^\$/, '') : unwindSpec.path.replace(/^\$/, '');
  const output = [];

  docs.forEach((doc) => {
    const value = getByPath(doc, path);
    if (Array.isArray(value)) {
      value.forEach((item) => {
        const copy = serializeForJson(doc);
        setByPath(copy, path, item);
        output.push(copy);
      });
    } else if (value !== undefined && value !== null) {
      output.push(doc);
    }
  });

  return output;
};

const projectDocuments = (docs, projectSpec) => docs.map((doc) => {
  const output = {};

  Object.entries(projectSpec).forEach(([field, spec]) => {
    if (field === '_id' && spec === 0) return;
    if (spec === 1) {
      output[field] = doc[field];
    } else if (typeof spec === 'string' && spec.startsWith('$')) {
      output[field] = getByPath(doc, spec.slice(1));
    } else if (spec !== 0) {
      output[field] = spec;
    }
  });

  return output;
});

module.exports = {
  createModel,
  generateId,
  normalizeId,
  matchesFilter
};
