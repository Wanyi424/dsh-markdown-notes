// node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
var write = Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
  if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
  } finally {
    ancestors.delete(value);
  }
}
function createVolatile(value) {
  let current = snapshot(value);
  return Object.freeze({
    get: () => current,
    [write]: (value2) => {
      current = value2;
    }
  });
}
function isVolatile(value) {
  return typeof value === "object" && value !== null && write in value;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  const ancestors = /* @__PURE__ */ new Set();
  function compare(a2, b2) {
    if (a2 === b2) return true;
    if (isVolatile(a2) || isVolatile(b2)) return isVolatile(a2) && isVolatile(b2);
    if (!strict && isNullable(a2) && isNullable(b2)) return true;
    if (typeof a2 !== typeof b2 || typeof a2 !== "object" || !a2 || !b2) return false;
    if (ancestors.has(a2)) return false;
    function check(test, then) {
      return test(a2) ? test(b2) ? then(a2, b2) : false : test(b2) ? false : void 0;
    }
    ancestors.add(a2);
    try {
      return check(Array.isArray, (a3, b3) => {
        if (a3.length !== b3.length) return false;
        for (let index = 0; index < a3.length; index++) if (!compare(a3[index], b3[index])) return false;
        return true;
      }) ?? check(is("Date"), (a3, b3) => a3.valueOf() === b3.valueOf()) ?? check(is("URL"), (a3, b3) => a3.href === b3.href) ?? check(is("RegExp"), (a3, b3) => a3.source === b3.source && a3.flags === b3.flags) ?? check(isArrayBufferLike, (a3, b3) => {
        if (a3.byteLength !== b3.byteLength) return false;
        const viewA = new Uint8Array(a3);
        const viewB = new Uint8Array(b3);
        for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
        return true;
      }) ?? ((!strict || [a2, b2].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
        ...a2,
        ...b2
      }).every((key) => compare(a2[key], b2[key])));
    } finally {
      ancestors.delete(a2);
    }
  }
  return compare(a, b);
}
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = Symbol.for("schemastery");
var kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (isVolatile(value)) value = value.get();
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.volatile = function volatile() {
  if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
  return this.extra("volatile", true);
};
var resolvers = {};
var checkedVolatile = Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
  const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
  if (states.has(blocked)) return;
  states.add(blocked);
  seen.set(schema, states);
  if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
  const nested = blocked || !!schema.meta?.volatile;
  if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
  if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
  if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
  if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve4) {
  resolvers[type] = resolve4;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (!options[checkedVolatile]) {
    validateVolatileSchema(schema, options.path);
    options = {
      ...options,
      [checkedVolatile]: true
    };
  }
  if (schema.meta?.volatile) {
    const inner = Schema(schema);
    inner.meta = {
      ...schema.meta,
      volatile: false
    };
    const [value, adapted] = Schema.resolve(data, inner, options, strict);
    try {
      return [createVolatile(value), adapted];
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error), options);
    }
  }
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
    validateVolatileSchema(schema.inner, options.path, true);
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name2, keys, format) {
  formatters[name2] = format;
  Object.assign(Schema, { [name2](...args) {
    const schema = new Schema({ type: name2 });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name2 === "object" || name2 === "dict") schema.meta.default = {};
    else if (name2 === "array" || name2 === "tuple") schema.meta.default = [];
    else if (name2 === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// src/contracts.ts
var MAX_NOTE_BYTES = 2 * 1024 * 1024;
var MAX_IMPORT_BYTES = 20 * 1024 * 1024;
var MAX_IMPORT_FILES = 20;
var API_PATH = "/api/markdown-notes";

// src/storage.ts
import { mkdir, readdir, readFile, writeFile, lstat, rename, unlink, link, copyFile, realpath, rmdir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join as join3, resolve as resolve3, relative, parse, sep } from "node:path";
import { homedir as homedir2 } from "node:os";
import { randomUUID } from "node:crypto";

// src/sample.ts
var SAMPLE_NAME = "Markdown \u5185\u5BB9\u793A\u4F8B.md";
var SAMPLE_CONTENT = '# \u63A2\u7D22 Markdown \u7684\u5947\u5999\u4E16\u754C\r\n\r\n\u6B22\u8FCE\u6765\u5230 Markdown \u7684\u5947\u5999\u4E16\u754C\uFF01\u65E0\u8BBA\u4F60\u662F\u5199\u4F5C\u7231\u597D\u8005\u3001\u5F00\u53D1\u8005\u3001\u535A\u4E3B\uFF0C\u8FD8\u662F\u60F3\u8981\u7B80\u5355\u8BB0\u5F55\u70B9\u4EC0\u4E48\u7684\u4EBA\uFF0CMarkdown \u90FD\u80FD\u6210\u4E3A\u4F60\u65B0\u7684\u597D\u4F19\u4F34\u3002\u5B83\u4E0D\u4EC5\u8BA9\u5199\u4F5C\u53D8\u5F97\u7B80\u5355\u660E\u4E86\uFF0C\u8FD8\u80FD\u8F7B\u677E\u5730\u5C06\u5185\u5BB9\u8F6C\u5316\u4E3A\u6F02\u4EAE\u7684\u7F51\u9875\u683C\u5F0F\u3002\u4ECA\u5929\uFF0C\u6211\u4EEC\u5C06\u5168\u9762\u63A2\u8BA8 Markdown \u7684\u57FA\u7840\u548C\u8FDB\u9636\u8BED\u6CD5\uFF0C\u8BA9\u4F60\u5728\u8FD9\u4E2A\u8FC7\u7A0B\u4E2D\u5145\u5206\u4EAB\u53D7\u5199\u4F5C\u7684\u4E50\u8DA3\uFF01\r\n\r\nMarkdown \u662F\u4E00\u79CD\u8F7B\u91CF\u7EA7\u6807\u8BB0\u8BED\u8A00\uFF0C\u7528\u4E8E\u683C\u5F0F\u5316\u7EAF\u6587\u672C\u3002\u5B83\u4EE5\u7B80\u5355\u3001\u76F4\u89C2\u7684\u8BED\u6CD5\u800C\u8457\u79F0\uFF0C\u53EF\u4EE5\u5FEB\u901F\u5730\u751F\u6210 HTML\u3002Markdown \u662F\u5199\u4F5C\u4E0E\u4EE3\u7801\u7684\u5B8C\u7F8E\u7ED3\u5408\uFF0C\u65E2\u7B80\u5355\u53C8\u5F3A\u5927\u3002\r\n\r\n## Markdown \u57FA\u7840\u8BED\u6CD5\r\n\r\n### 1. \u6807\u9898\uFF1A\u8BA9\u4F60\u7684\u5185\u5BB9\u5C42\u6B21\u5206\u660E\r\n\r\n\u7528 `#` \u53F7\u6765\u521B\u5EFA\u6807\u9898\u3002\u6807\u9898\u4ECE `#` \u5F00\u59CB\uFF0C`#` \u7684\u6570\u91CF\u8868\u793A\u6807\u9898\u7684\u7EA7\u522B\u3002\r\n\r\n```markdown\r\n# \u4E00\u7EA7\u6807\u9898\r\n\r\n## \u4E8C\u7EA7\u6807\u9898\r\n\r\n### \u4E09\u7EA7\u6807\u9898\r\n\r\n#### \u56DB\u7EA7\u6807\u9898\r\n```\r\n\r\n\u4EE5\u4E0A\u4EE3\u7801\u5C06\u6E32\u67D3\u51FA\u4E00\u7EC4\u5C42\u6B21\u5206\u660E\u7684\u6807\u9898\uFF0C\u4F7F\u4F60\u7684\u5185\u5BB9\u4E95\u4E95\u6709\u6761\u3002\r\n\r\n### 2. \u6BB5\u843D\u4E0E\u6362\u884C\uFF1A\u81EA\u7136\u6D41\u7545\r\n\r\nMarkdown \u4E2D\u7684\u6BB5\u843D\u5C31\u662F\u4E00\u884C\u63A5\u4E00\u884C\u7684\u6587\u672C\u3002\u8981\u521B\u5EFA\u65B0\u6BB5\u843D\uFF0C\u53EA\u9700\u5728\u4E24\u884C\u6587\u672C\u4E4B\u95F4\u7A7A\u4E00\u884C\u3002\r\n\r\n### 3. \u5B57\u4F53\u6837\u5F0F\uFF1A\u5F3A\u8C03\u4F60\u7684\u6587\u5B57\r\n\r\n- **\u7C97\u4F53**\uFF1A\u7528\u4E24\u4E2A\u661F\u53F7\u6216\u4E0B\u5212\u7EBF\u5305\u88F9\u6587\u5B57\uFF0C\u5982 `**\u7C97\u4F53**` \u6216 `__\u7C97\u4F53__`\u3002\r\n- _\u659C\u4F53_\uFF1A\u7528\u4E00\u4E2A\u661F\u53F7\u6216\u4E0B\u5212\u7EBF\u5305\u88F9\u6587\u5B57\uFF0C\u5982 `*\u659C\u4F53*` \u6216 `_\u659C\u4F53_`\u3002\r\n- ~~\u5220\u9664\u7EBF~~\uFF1A\u7528\u4E24\u4E2A\u6CE2\u6D6A\u7EBF\u5305\u88F9\u6587\u5B57\uFF0C\u5982 `~~\u5220\u9664\u7EBF~~`\u3002\r\n- ==\u9AD8\u4EAE==\uFF1A\u7528\u4E24\u4E2A\u7B49\u53F7\u5305\u88F9\u6587\u5B57\uFF0C\u5982 `==\u9AD8\u4EAE==`\u3002\r\n- ++\u4E0B\u5212\u7EBF++\uFF1A\u7528\u4E24\u4E2A\u52A0\u53F7\u5305\u88F9\u6587\u5B57\uFF0C\u5982 `++\u4E0B\u5212\u7EBF++`\u3002\r\n- ~\u6CE2\u6D6A\u7EBF~\uFF1A\u7528\u4E00\u4E2A\u6CE2\u6D6A\u7EBF\u5305\u88F9\u6587\u5B57\uFF0C\u5982 `~\u6CE2\u6D6A\u7EBF~`\u3002\r\n\r\n\u8FD9\u4E9B\u7B80\u5355\u7684\u6807\u8BB0\u53EF\u4EE5\u8BA9\u4F60\u7684\u5185\u5BB9\u66F4\u6709\u5C42\u6B21\u611F\u548C\u91CD\u70B9\u7A81\u51FA\u3002\r\n\r\n### 4. \u5217\u8868\uFF1A\u6574\u6D01\u6709\u5E8F\r\n\r\n- **\u65E0\u5E8F\u5217\u8868**\uFF1A\u7528 `-`\u3001`*` \u6216 `+` \u52A0\u7A7A\u683C\u5F00\u59CB\u4E00\u884C\u3002\r\n- **\u6709\u5E8F\u5217\u8868**\uFF1A\u4F7F\u7528\u6570\u5B57\u52A0\u70B9\u53F7\uFF08`1.`\u3001`2.`\uFF09\u5F00\u59CB\u4E00\u884C\u3002\r\n\r\n\u5728\u5217\u8868\u4E2D\u5D4C\u5957\u5176\u4ED6\u5185\u5BB9\uFF1F\u53EA\u9700\u7F29\u8FDB\u5373\u53EF\u5B9E\u73B0\u5D4C\u5957\u6548\u679C\u3002\r\n\r\n- \u65E0\u5E8F\u5217\u8868\u9879 1\r\n  1. \u5D4C\u5957\u6709\u5E8F\u5217\u8868\u9879 1\r\n  2. \u5D4C\u5957\u6709\u5E8F\u5217\u8868\u9879 2\r\n- \u65E0\u5E8F\u5217\u8868\u9879 2\r\n\r\n1. \u6709\u5E8F\u5217\u8868\u9879 1\r\n2. \u6709\u5E8F\u5217\u8868\u9879 2\r\n\r\n### 5. \u94FE\u63A5\u4E0E\u56FE\u7247\uFF1A\u4E30\u5BCC\u5185\u5BB9\r\n\r\n- **\u94FE\u63A5**\uFF1A\u7528\u65B9\u62EC\u53F7\u548C\u5706\u62EC\u53F7\u521B\u5EFA\u94FE\u63A5 `[\u663E\u793A\u6587\u672C](\u94FE\u63A5\u5730\u5740)`\u3002\r\n- **\u56FE\u7247**\uFF1A\u548C\u94FE\u63A5\u7C7B\u4F3C\uFF0C\u53EA\u9700\u5728\u524D\u9762\u52A0\u4E0A `!`\uFF0C\u5982 `![\u63CF\u8FF0\u6587\u672C](\u56FE\u7247\u94FE\u63A5)`\u3002\r\n\r\n[\u8BBF\u95EE Wanyi424 \u7684 GitHub \u4E3B\u9875](https://github.com/Wanyi424)\r\n\r\n![DSH Markdown Notes \u63D2\u4EF6\u5BA3\u4F20\u56FE](https://raw.githubusercontent.com/Wanyi424/dsh-markdown-notes/main/docs/images/plugin-banner.png)\r\n\r\n\u8F7B\u677E\u5B9E\u73B0\u5BCC\u5A92\u4F53\u5185\u5BB9\u5C55\u793A\uFF01\r\n\r\n> \u56E0\u5FAE\u4FE1\u516C\u4F17\u53F7\u5E73\u53F0\u4E0D\u652F\u6301\u9664\u516C\u4F17\u53F7\u5185\u5BB9\u4EE5\u5916\u7684\u94FE\u63A5\uFF0C\u6545\u5176\u4ED6\u5E73\u53F0\u7684\u94FE\u63A5\uFF0C\u4F1A\u5448\u73B0\u94FE\u63A5\u6837\u5F0F\u4F46\u65E0\u6CD5\u70B9\u51FB\u8DF3\u8F6C\u3002\r\n\r\n> \u5BF9\u4E8E\u8FD9\u4E9B\u94FE\u63A5\u8BF7\u6CE8\u610F\u660E\u6587\u4E66\u5199\uFF0C\u6216\u70B9\u51FB\u5DE6\u4E0A\u89D2\u300C\u683C\u5F0F->\u5FAE\u4FE1\u5916\u94FE\u63A5\u8F6C\u5E95\u90E8\u5F15\u7528\u300D\u5F00\u542F\u5F15\u7528\uFF0C\u8FD9\u6837\u5C31\u53EF\u4EE5\u5728\u5E95\u90E8\u89C2\u5BDF\u5230\u94FE\u63A5\u6307\u5411\u3002\r\n\r\n\u53E6\u5916\uFF0C\u4F7F\u7528 `<![alt](url),![alt](url)>` \u8BED\u6CD5\u53EF\u4EE5\u521B\u5EFA\u6A2A\u5C4F\u6ED1\u52A8\u5E7B\u706F\u7247\uFF0C\u652F\u6301\u5FAE\u4FE1\u516C\u4F17\u53F7\u5E73\u53F0\u3002\u5EFA\u8BAE\u4F7F\u7528\u76F8\u4F3C\u5C3A\u5BF8\u7684\u56FE\u7247\u4EE5\u83B7\u5F97\u6700\u4F73\u663E\u793A\u6548\u679C\u3002\r\n\r\n### 6. \u5F15\u7528\uFF1A\u5F15\u7528\u540D\u8A00\u6216\u5F15\u4EBA\u6DF1\u601D\u7684\u53E5\u5B50\r\n\r\n\u4F7F\u7528 `>` \u6765\u521B\u5EFA\u5F15\u7528\uFF0C\u53EA\u9700\u5728\u6587\u672C\u524D\u9762\u52A0\u4E0A\u5B83\u3002\u591A\u5C42\u5F15\u7528\uFF1F\u5728\u524D\u4E00\u5C42 `>` \u540E\u518D\u52A0\u4E00\u4E2A\u5C31\u884C\u3002\r\n\r\n> \u8FD9\u662F\u4E00\u4E2A\u5F15\u7528\r\n>\r\n> > \u8FD9\u662F\u4E00\u4E2A\u5D4C\u5957\u5F15\u7528\r\n\r\n\u8FD9\u8BA9\u4F60\u7684\u5F15\u7528\u66F4\u52A0\u5BCC\u6709\u5C42\u6B21\u611F\u3002\r\n\r\n### 7. \u4EE3\u7801\u5757\uFF1A\u5C55\u793A\u4F60\u7684\u4EE3\u7801\r\n\r\n- **\u884C\u5185\u4EE3\u7801**\uFF1A\u7528\u53CD\u5F15\u53F7\u5305\u88F9\uFF0C\u5982 `code`\u3002\r\n- **\u4EE3\u7801\u5757**\uFF1A\u7528\u4E09\u4E2A\u53CD\u5F15\u53F7\u5305\u88F9\uFF0C\u5E76\u6307\u5B9A\u8BED\u8A00\uFF0C\u5982\uFF1A\r\n\r\n```js\r\nconsole.log(`Hello, Doocs!`)\r\n```\r\n\r\n\u8BED\u6CD5\u9AD8\u4EAE\u8BA9\u4F60\u7684\u4EE3\u7801\u66F4\u6613\u8BFB\u3002\r\n\r\n### 8. \u5206\u5272\u7EBF\uFF1A\u5206\u5272\u5185\u5BB9\r\n\r\n\u7528\u4E09\u4E2A\u6216\u66F4\u591A\u7684 `-`\u3001`*` \u6216 `_` \u6765\u521B\u5EFA\u5206\u5272\u7EBF\u3002\r\n\r\n---\r\n\r\n\u4E3A\u4F60\u7684\u5185\u5BB9\u6DFB\u52A0\u89C6\u89C9\u5206\u9694\u3002\r\n\r\n### 9. \u8868\u683C\uFF1A\u6E05\u6670\u5C55\u793A\u6570\u636E\r\n\r\nMarkdown \u652F\u6301\u7B80\u5355\u7684\u8868\u683C\uFF0C\u7528 `|` \u548C `-` \u5206\u9694\u5355\u5143\u683C\u548C\u8868\u5934\u3002\r\n\r\n| \u9879\u76EE\u4EBA\u5458                                    | \u90AE\u7BB1                   | \u5FAE\u4FE1\u53F7       |\r\n| ------------------------------------------- | ---------------------- | ------------ |\r\n| [yanglbme](https://github.com/yanglbme)     | contact@yanglibin.info | YLB0109      |\r\n| [YangFong](https://github.com/YangFong)     | yangfong2022@gmail.com | yq2419731931 |\r\n\r\n\u8FD9\u6837\u7684\u8868\u683C\u8BA9\u6570\u636E\u5C55\u793A\u66F4\u4E3A\u6E05\u723D\uFF01\r\n\r\n> \u624B\u52A8\u7F16\u5199\u6807\u8BB0\u592A\u9EBB\u70E6\uFF1F\u6211\u4EEC\u63D0\u4F9B\u4E86\u4FBF\u6377\u65B9\u5F0F\u3002\u5DE6\u4E0A\u65B9\u70B9\u51FB\u300C\u7F16\u8F91->\u63D2\u5165\u8868\u683C\u300D\uFF0C\u5373\u53EF\u5FEB\u901F\u5B9E\u73B0\u8868\u683C\u6E32\u67D3\u3002\r\n\r\n### 10. \u76EE\u5F55\uFF1A\u81EA\u52A8\u751F\u6210\u6587\u6863\u5BFC\u822A\r\n\r\n\u5728\u6587\u6863\u4E2D\u5355\u72EC\u4E00\u884C\u5199\u5165 `[TOC]`\uFF0C\u5373\u53EF\u6839\u636E\u6587\u6863\u6807\u9898\u81EA\u52A8\u751F\u6210\u5C42\u7EA7\u76EE\u5F55\uFF0C\u65B9\u4FBF\u8BFB\u8005\u5FEB\u901F\u8DF3\u8F6C\u3002\r\n\r\n```markdown\r\n[TOC]\r\n```\r\n\r\n> \u4E00\u7EA7\u6807\u9898\uFF08`#`\uFF09\u4E0D\u4F1A\u51FA\u73B0\u5728\u76EE\u5F55\u4E2D\uFF0C\u76EE\u5F55\u951A\u70B9\u6839\u636E\u6807\u9898\u5728\u6587\u6863\u4E2D\u7684\u4F4D\u7F6E\u81EA\u52A8\u751F\u6210\u3002\r\n\r\n## Markdown \u8FDB\u9636\u6280\u5DE7\r\n\r\n### 1. LaTeX \u516C\u5F0F\uFF1A\u5B8C\u7F8E\u5C55\u793A\u6570\u5B66\u8868\u8FBE\u5F0F\r\n\r\nMarkdown \u5141\u8BB8\u5D4C\u5165 LaTeX \u8BED\u6CD5\u5C55\u793A\u6570\u5B66\u516C\u5F0F\uFF1A\r\n\r\n- **\u884C\u5185\u516C\u5F0F**\uFF1A\u7528 `$` \u5305\u88F9\u516C\u5F0F\uFF0C\u5982 $E = mc^2$\u3002\r\n- **\u5757\u7EA7\u516C\u5F0F**\uFF1A\u7528 `$$` \u5305\u88F9\u516C\u5F0F\uFF0C\u5982\uFF1A\r\n\r\n$$\r\n\\begin{aligned}\r\nd_{i, j} &\\leftarrow d_{i, j} + 1 \\\\\r\nd_{i, y + 1} &\\leftarrow d_{i, y + 1} - 1 \\\\\r\nd_{x + 1, j} &\\leftarrow d_{x + 1, j} - 1 \\\\\r\nd_{x + 1, y + 1} &\\leftarrow d_{x + 1, y + 1} + 1\r\n\\end{aligned}\r\n$$\r\n\r\n\u73B0\u5728\u8FD8\u652F\u6301 **LaTeX \u6807\u51C6\u683C\u5F0F**\uFF1A\r\n\r\n- **\u884C\u5185\u516C\u5F0F**\uFF1A\u7528 `\\(...\\)` \u5305\u88F9\u516C\u5F0F\uFF0C\u5982 \\(x^2 + y^2 = z^2\\)\u3002\r\n- **\u5757\u7EA7\u516C\u5F0F**\uFF1A\u7528 `\\[...\\]` \u5305\u88F9\u516C\u5F0F\uFF0C\u5982\uFF1A\r\n\r\n\\[\r\n\\int\\_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}\r\n\\]\r\n\r\n\u6DF7\u5408\u4F7F\u7528\u793A\u4F8B\uFF1A\u4F20\u7EDF\u683C\u5F0F $a + b = c$ \u548C LaTeX \u683C\u5F0F \\(d + e = f\\) \u53EF\u4EE5\u5728\u540C\u4E00\u6BB5\u843D\u4E2D\u5171\u5B58\u3002\r\n\r\n1. \u5217\u8868\u5185\u5757\u516C\u5F0F 1\r\n\r\n$$\r\n\\chi^2 = \\sum \\frac{(O - E)^2}{E}\r\n$$\r\n\r\n2. \u5217\u8868\u5185\u5757\u516C\u5F0F 2\r\n\r\n$$\r\n\\chi^2 = \\sum \\frac{(|O - E| - 0.5)^2}{E}\r\n$$\r\n\r\n\u8FD9\u662F\u5C55\u793A\u590D\u6742\u6570\u5B66\u8868\u8FBE\u7684\u5229\u5668\uFF01\r\n\r\n> [!TIP]\r\n> \u9884\u89C8\u533A\u57DF\u7684 LaTeX \u516C\u5F0F\u652F\u6301\u70B9\u51FB\u7F16\u8F91\uFF0C\u70B9\u51FB\u540E\u5F39\u51FA\u516C\u5F0F\u7F16\u8F91\u5668\uFF0C\u5185\u7F6E\u5E38\u7528\u516C\u5F0F\u5E93\uFF0C\u53EF\u5FEB\u901F\u5B8C\u6210\u516C\u5F0F\u4FEE\u6539\u3002\r\n\r\n### 2. Mermaid \u6D41\u7A0B\u56FE\uFF1A\u53EF\u89C6\u5316\u6D41\u7A0B\r\n\r\nMermaid \u662F\u5F3A\u5927\u7684\u53EF\u89C6\u5316\u5DE5\u5177\uFF0C\u53EF\u4EE5\u5728 Markdown \u4E2D\u521B\u5EFA\u6D41\u7A0B\u56FE\u3001\u65F6\u5E8F\u56FE\u7B49\u3002\r\n\r\n```mermaid\r\ngraph LR\r\n  A[GraphCommand] --> B[update]\r\n  A --> C[goto]\r\n  A --> D[send]\r\n\r\n  B --> B1[\u66F4\u65B0\u72B6\u6001]\r\n  C --> C1[\u6D41\u7A0B\u63A7\u5236]\r\n  D --> D1[\u6D88\u606F\u4F20\u9012]\r\n```\r\n\r\n```mermaid\r\ngraph TD;\r\n  A-->B;\r\n  A-->C;\r\n  B-->D;\r\n  C-->D;\r\n```\r\n\r\n```mermaid\r\npie\r\n  title Key elements in Product X\r\n  "Calcium" : 42.96\r\n  "Potassium" : 50.05\r\n  "Magnesium" : 10.01\r\n  "Iron" : 5\r\n```\r\n\r\n```mermaid\r\npie\r\n  title \u4E3A\u4EC0\u4E48\u603B\u662F\u5B85\u5728\u5BB6\u91CC\uFF1F\r\n  "\u559C\u6B22\u5B85" : 45\r\n  "\u5929\u6C14\u592A\u70ED" : 70\r\n  "\u7A77" : 500\r\n  "\u6CA1\u4EBA\u7EA6" : 95\r\n```\r\n\r\n\u8FD9\u79CD\u65B9\u5F0F\u4E0D\u4EC5\u80FD\u76F4\u89C2\u5C55\u793A\u6D41\u7A0B\uFF0C\u8FD8\u80FD\u63D0\u5347\u6587\u6863\u7684\u4E13\u4E1A\u6027\u3002\r\n\r\n> \u66F4\u591A\u7528\u6CD5\uFF0C\u53C2\u89C1\uFF1A[Mermaid User Guide](https://mermaid.js.org/intro/getting-started.html)\u3002\r\n\r\n### 3. PlantUML \u6D41\u7A0B\u56FE\uFF1A\u53EF\u89C6\u5316\u6D41\u7A0B\r\n\r\nPlantUML \u662F\u5F3A\u5927\u7684\u53EF\u89C6\u5316\u5DE5\u5177\uFF0C\u53EF\u4EE5\u5728 Markdown \u4E2D\u521B\u5EFA\u6D41\u7A0B\u56FE\u3001\u65F6\u5E8F\u56FE\u7B49\u3002\r\n\r\n```plantuml\r\n@startuml\r\nparticipant Participant as Foo\r\nactor       Actor       as Foo1\r\nboundary    Boundary    as Foo2\r\ncontrol     Control     as Foo3\r\nentity      Entity      as Foo4\r\ndatabase    Database    as Foo5\r\ncollections Collections as Foo6\r\nqueue       Queue       as Foo7\r\nFoo -> Foo1 : To actor\r\nFoo -> Foo2 : To boundary\r\nFoo -> Foo3 : To control\r\nFoo -> Foo4 : To entity\r\nFoo -> Foo5 : To database\r\nFoo -> Foo6 : To collections\r\nFoo -> Foo7: To queue\r\n@enduml\r\n```\r\n\r\n> \u66F4\u591A\u7528\u6CD5\uFF0C\u53C2\u89C1\uFF1A[PlantUML \u4E3B\u9875](https://plantuml.com/zh/)\u3002\r\n\r\n### 4. Infographic \u4FE1\u606F\u56FE\uFF1A\u53EF\u89C6\u5316\u6570\u636E\r\n\r\n\u65B0\u4E00\u4EE3\u4FE1\u606F\u56FE\u53EF\u89C6\u5316\u5F15\u64CE\uFF0C\u8BA9\u6587\u5B57\u4FE1\u606F\u6829\u6829\u5982\u751F\uFF01\r\n\r\n```infographic\r\ninfographic list-row-horizontal-icon-arrow\r\ndata\r\n  title \u5BA2\u6237\u589E\u957F\u5F15\u64CE\r\n  desc \u591A\u6E20\u9053\u89E6\u8FBE\u4E0E\u590D\u8D2D\u63D0\u5347\r\n  items\r\n    - label \u7EBF\u7D22\u83B7\u53D6\r\n      value 18.6\r\n      desc \u6E20\u9053\u6295\u653E\u4E0E\u5185\u5BB9\u83B7\u5BA2\r\n      icon rocket-launch\r\n    - label \u8F6C\u5316\u63D0\u6548\r\n      value 12.4\r\n      desc \u7EBF\u7D22\u8BC4\u5206\u4E0E\u81EA\u52A8\u8DDF\u8FDB\r\n      icon progress-check\r\n    - label \u590D\u8D2D\u63D0\u5347\r\n      value 9.8\r\n      desc \u4F1A\u5458\u4F53\u7CFB\u4E0E\u6743\u76CA\u8FD0\u8425\r\n      icon account-sync\r\n    - label \u53E3\u7891\u4F20\u64AD\r\n      value 6.2\r\n      desc \u793E\u7FA4\u6FC0\u52B1\u4E0E\u63A8\u8350\u88C2\u53D8\r\n      icon account-group\r\n```\r\n\r\n> \u66F4\u591A\u7528\u6CD5\uFF0C\u53C2\u89C1\uFF1A[AntV Infographic Gallery](https://infographic.antv.vision/gallery)\u3002\r\n\r\n### 5. Ruby \u6CE8\u97F3\uFF1A\u6CE8\u97F3\u6807\u6CE8\r\n\r\n\u652F\u6301\u4E24\u79CD\u683C\u5F0F\uFF1A\r\n\r\n```md\r\n1. [\u6587\u5B57]{\u6CE8\u97F3}\r\n2. [\u6587\u5B57]^(\u6CE8\u97F3)\r\n```\r\n\r\n\u6E32\u67D3\u6548\u679C\u5982\u4E0B\uFF1A\r\n\r\n[\u4F60\u597D]{n\u01D0 h\u01CEo} [\u4E16\u754C]{sh\xEC ji\xE8}\r\n\r\n\u652F\u6301\u56DB\u79CD\u5206\u9694\u7B26\uFF1A `\u30FB`\uFF08\u4E2D\u70B9\uFF09\u3001`\uFF0E` (\u5168\u89D2\u53E5\u70B9)\u3001`\u3002` (\u4E2D\u6587\u53E5\u53F7)\u3001`-` (\u82F1\u6587\u51CF\u53F7)\r\n\r\n\u793A\u4F8B\uFF1A\r\n\r\n```md\r\n[\u4F60\u597D\u4E16\u754C]{n\u01D0\u30FBh\u01CEo\u30FBsh\xEC\u30FBji\xE8}\r\n[\u5C0F\u591C\u6642\u96E8]^(\u3055\u30FB\u3088\u30FB\u3057\u3050\u308C)\r\n```\r\n\r\n[\u4F60\u597D\u4E16\u754C]{n\u01D0\u30FBh\u01CEo\u30FBsh\xEC\u30FBji\xE8}\r\n[\u5C0F\u591C\u6642\u96E8]^(\u3055\u30FB\u3088\u30FB\u3057\u3050\u308C)\r\n\r\n\u5F53\u5B57\u7B26\u4E32\u6570\u91CF\u4E0E\u5206\u9694\u7B26\u6570\u91CF\u4E0D\u5339\u914D\u65F6\uFF0C\u4F1A\u81EA\u52A8\u5339\u914D\u5230\u6700\u5408\u9002\u7684\u5206\u9694\u7B26\u3002\r\n\r\n```md\r\n[\u5C0F\u591C\u6642\u96E8]{\u3055\u30FB\u3088\u30FB\u3057\u3050\u308C}\r\n[\u5C0F\u591C\u6642\u96E8]{\u3055\u30FB\u3088}\r\n[\u5C0F\u591C]{\u3055\u30FB\u3088\u30FB\u3057\u3050\u308C}\r\n[\u5C0F\u591C\u6642\u96E8]{\u3055\u30FB\u3088\u30FB\u3057\u3050\u308C\u30FBextra}\r\n```\r\n\r\n[\u5C0F\u591C\u6642\u96E8]{\u3055\u30FB\u3088\u30FB\u3057\u3050\u308C}\r\n[\u5C0F\u591C\u6642\u96E8]{\u3055\u30FB\u3088}\r\n[\u5C0F\u591C]{\u3055\u30FB\u3088\u30FB\u3057\u3050\u308C}\r\n[\u5C0F\u591C\u6642\u96E8]{\u3055\u30FB\u3088\u30FB\u3057\u3050\u308C\u30FBextra}\r\n\r\n### 6. \u8B66\u544A\u5757\u4E0E\u73AF\u5883\uFF1A\u7A81\u51FA\u91CD\u70B9\u5185\u5BB9\r\n\r\n\u4F7F\u7528 `> [!\u7C7B\u578B]` \u6216 `::: \u7C7B\u578B ... :::` \u8BED\u6CD5\u5373\u53EF\u521B\u5EFA\u5E26\u6837\u5F0F\u7684\u8B66\u544A\u5757\u3002\u7C7B\u578B\u540E\u8FD8\u80FD\u8DDF\u4E00\u4E2A**\u81EA\u5B9A\u4E49\u6807\u9898**\uFF0C\u6B63\u6587\u652F\u6301\u5B8C\u6574\u7684 Markdown \u4E0E\u516C\u5F0F\u3002\r\n\r\n\u5E38\u7528\u7684\u63D0\u793A\u7C7B\u578B\uFF1A\r\n\r\n> [!NOTE]\r\n> \u63D0\u9192\u8BFB\u8005\u5373\u4F7F\u5728\u5FEB\u901F\u6D4F\u89C8\u65F6\u4E5F\u5E94\u7559\u610F\u7684\u4FE1\u606F\u3002\r\n\r\n> [!TIP]\r\n> \u5E2E\u52A9\u8BFB\u8005\u66F4\u987A\u5229\u5B8C\u6210\u64CD\u4F5C\u7684\u5C0F\u6280\u5DE7\u3002\r\n\r\n> [!IMPORTANT] \u4E0A\u7EBF\u524D\u5FC5\u8BFB\r\n> \u7C7B\u578B\u540E\u53EF\u4EE5\u8DDF\u81EA\u5B9A\u4E49\u6807\u9898\uFF0C\u8986\u76D6\u9ED8\u8BA4\u6807\u9898\u3002\r\n\r\n> [!WARNING]\r\n> \u9700\u8981\u7ACB\u5373\u5F15\u8D77\u6CE8\u610F\u7684\u5173\u952E\u5185\u5BB9\u3002\r\n\r\n\u4E5F\u53EF\u4EE5\u4F7F\u7528 `:::` \u5BB9\u5668\u8BED\u6CD5\uFF0C\u6548\u679C\u76F8\u540C\uFF1A\r\n\r\n::: tip\r\n\u8FD9\u662F\u4E00\u4E2A\u4F7F\u7528\u5BB9\u5668\u8BED\u6CD5\u7684\u63D0\u793A\u6846\u3002\r\n:::\r\n\r\n\u8FD8\u5185\u7F6E\u4E86\u5B9A\u7406\u3001\u5F15\u7406\u3001\u5B9A\u4E49\u7B49**\u5B66\u672F\u73AF\u5883**\uFF0C\u6B63\u6587\u53EF\u76F4\u63A5\u4E66\u5199\u516C\u5F0F\uFF1A\r\n\r\n::: theorem \u52FE\u80A1\u5B9A\u7406\r\n\u5728\u76F4\u89D2\u4E09\u89D2\u5F62\u4E2D\uFF0C\u659C\u8FB9\u7684\u5E73\u65B9\u7B49\u4E8E\u4E24\u6761\u76F4\u89D2\u8FB9\u7684\u5E73\u65B9\u548C\uFF1A$a^2 + b^2 = c^2$\u3002\r\n:::\r\n\r\n::: definition\r\n\u82E5\u5BF9\u4EFB\u610F $\\varepsilon > 0$\uFF0C\u5B58\u5728 $\\delta > 0$\uFF0C\u4F7F\u5F97 $0 < |x - a| < \\delta$ \u65F6\u6709 $|f(x) - L| < \\varepsilon$\uFF0C\u5219\u79F0 $\\lim_{x \\to a} f(x) = L$\u3002\r\n:::\r\n\r\n::: proof\r\n\u7531\u4E0A\u8FF0\u5B9A\u4E49\u76F4\u63A5\u53EF\u5F97\uFF0C\u8BC1\u6BD5\u3002\r\n:::\r\n\r\n\u7C7B\u578B\u540D\u79F0\u53EF\u4EE5\u662F**\u4EFB\u610F\u6587\u5B57**\uFF08\u5305\u62EC\u4E2D\u6587\uFF09\uFF0C\u672A\u5339\u914D\u5230\u5185\u7F6E\u6837\u5F0F\u65F6\u4F1A\u4F7F\u7528\u7EDF\u4E00\u7684\u9ED8\u8BA4\u6837\u5F0F\uFF0C\u5E76\u4EE5\u540D\u79F0\u4F5C\u4E3A\u6807\u9898\uFF1A\r\n\r\n::: \u63A8\u8BBA\r\n\u4EFB\u610F\u540D\u79F0\u90FD\u4F1A\u6E32\u67D3\u6210\u4E00\u4E2A\u5E26\u6807\u9898\u7684\u65B9\u6846\u3002\r\n:::\r\n\r\n## \u7ED3\u8BED\r\n\r\nMarkdown \u662F\u4E00\u79CD\u7B80\u5355\u3001\u5F3A\u5927\u4E14\u6613\u4E8E\u638C\u63E1\u7684\u6807\u8BB0\u8BED\u8A00\uFF0C\u901A\u8FC7\u5B66\u4E60\u57FA\u7840\u548C\u8FDB\u9636\u8BED\u6CD5\uFF0C\u4F60\u53EF\u4EE5\u5FEB\u901F\u521B\u4F5C\u5185\u5BB9\u5E76\u6709\u6548\u4F20\u8FBE\u4FE1\u606F\u3002\u65E0\u8BBA\u662F\u6280\u672F\u6587\u6863\u3001\u4E2A\u4EBA\u535A\u5BA2\u8FD8\u662F\u9879\u76EE\u8BF4\u660E\uFF0CMarkdown \u90FD\u662F\u4F60\u7684\u5F97\u529B\u52A9\u624B\u3002\u5E0C\u671B\u8FD9\u7BC7\u5185\u5BB9\u80FD\u591F\u5E26\u4F60\u5168\u9762\u4E86\u89E3 Markdown \u7684\u6F5C\u529B\uFF0C\u8BA9\u4F60\u7684\u5199\u4F5C\u66F4\u52A0\u4E30\u5BCC\u591A\u5F69\uFF01\r\n\r\n\u73B0\u5728\uFF0C\u62FF\u8D77 Markdown \u7F16\u8F91\u5668\uFF0C\u5F00\u59CB\u521B\u4F5C\u5427\uFF01\u63A2\u7D22 Markdown \u7684\u4E16\u754C\uFF0C\u4F60\u4F1A\u53D1\u73B0\u5B83\u8FDC\u6BD4\u60F3\u8C61\u4E2D\u66F4\u7CBE\u5F69\uFF01\r\n';

// src/note-path.ts
var baseName = (path) => path.slice(path.lastIndexOf("/") + 1);
var parentFolder = (path) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
var inFolder = (folder, name2) => folder ? `${folder}/${name2}` : name2;

// node_modules/@deepseek-ai/dsh-home-paths/lib/index.js
import { homedir } from "node:os";
import { basename, dirname, join, resolve as resolve2 } from "node:path";
var DSH_HOME_DIR_NAME = ".dsh";
var DEFAULT_DSH_HOME_DISPLAY = `~/${DSH_HOME_DIR_NAME}`;
var DSH_HOME_ENV = "DSH_HOME";
function defaultDshHome() {
  return join(homedir(), DSH_HOME_DIR_NAME);
}
function expandHomePath(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}
function resolveDshHome(configured, env = process.env) {
  const fromEnv = env[DSH_HOME_ENV];
  return resolve2(expandHomePath(configured ?? (fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : defaultDshHome())));
}
function dshHomePath(...segments) {
  return join(resolveDshHome(), ...segments);
}

// src/data-paths.ts
import { join as join2 } from "node:path";
function notesDataDirectory() {
  return dshHomePath("plugin-data", "dsh-markdown-notes");
}
function defaultNotesDirectory() {
  return join2(notesDataDirectory(), "notes");
}

// src/storage.ts
var NotesError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
async function writeImportedFile(path, content) {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {
    });
    await unlink(path).catch(() => {
    });
    throw error;
  }
}
function noteName(input) {
  if (typeof input !== "string") throw new NotesError("invalid-name", "\u8BF7\u8F93\u5165\u6587\u6863\u540D\u79F0\u3002");
  const value = input.trim();
  const stem = value.replace(/\.md$/i, "");
  const filename = /\.md$/i.test(value) ? value : `${value}.md`;
  if (!stem || stem === "." || stem === ".." || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(stem) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) || filename.length > 180) {
    throw new NotesError("invalid-name", "\u540D\u79F0\u4E0D\u80FD\u542B\u8DEF\u5F84\u3001\u7279\u6B8A\u7B26\u53F7\u6216\u4EE5\u70B9\u7ED3\u5C3E\uFF0C\u6700\u957F 180 \u4E2A\u5B57\u7B26\u3002");
  }
  return filename;
}
function folderPath(input, allowRoot = true) {
  if (typeof input !== "string" || !input && !allowRoot) throw new NotesError("invalid-name", "\u8BF7\u8F93\u5165\u6587\u4EF6\u5939\u540D\u79F0\u3002");
  if (input === "" && allowRoot) return "";
  const parts = input.split("/");
  if (parts.some((part) => !part || part !== part.trim() || part.startsWith(".") || /[<>:"\\|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || part.length > 180)) {
    throw new NotesError("invalid-name", "\u6587\u4EF6\u5939\u540D\u79F0\u4E0D\u80FD\u542B\u7279\u6B8A\u7B26\u53F7\u3001\u4EE5\u70B9\u5F00\u5934\u6216\u7ED3\u5C3E\uFF1B\u6BCF\u7EA7\u6700\u957F 180 \u4E2A\u5B57\u7B26\u3002");
  }
  return parts.join("/");
}
function notePath(input) {
  if (typeof input !== "string" || input.startsWith("/")) throw new NotesError("invalid-name", "\u8BF7\u8F93\u5165\u7B14\u8BB0\u76EE\u5F55\u5185\u7684\u76F8\u5BF9\u6587\u6863\u8DEF\u5F84\u3002");
  return inFolder(folderPath(parentFolder(input)), noteName(baseName(input)));
}
var NotesStore = class {
  constructor(directory = defaultNotesDirectory(), options = {}) {
    this.options = options;
    if (!isAbsolute(directory)) throw new NotesError("invalid-directory", "\u7B14\u8BB0\u76EE\u5F55\u5FC5\u987B\u4F7F\u7528\u7EDD\u5BF9\u8DEF\u5F84\u3002");
    this.currentDirectory = resolve3(directory);
  }
  currentDirectory;
  get directory() {
    return this.currentDirectory;
  }
  tail = Promise.resolve();
  serial(operation) {
    const run = this.tail.then(operation);
    this.tail = run.catch(() => void 0);
    return run;
  }
  async regular(name2) {
    const normalized = notePath(name2);
    const path = join3(await this.folder(parentFolder(normalized)), baseName(normalized));
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new NotesError("invalid-file", "\u53EA\u652F\u6301\u7B14\u8BB0\u76EE\u5F55\u5185\u7684\u666E\u901A Markdown \u6587\u4EF6\u3002");
    return path;
  }
  async folder(name2 = "", root = this.directory) {
    const normalized = folderPath(name2);
    let path = root;
    for (const part of ["", ...normalized.split("/").filter(Boolean)]) {
      if (part) path = join3(path, part);
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new NotesError("linked-directory", "\u53EA\u652F\u6301\u7B14\u8BB0\u76EE\u5F55\u5185\u7684\u666E\u901A\u6587\u4EF6\u5939\uFF0C\u4E0D\u652F\u6301\u94FE\u63A5\u6216\u8054\u63A5\u70B9\u3002");
    }
    return path;
  }
  async tree(root = this.directory) {
    const notes = [], folders = [], queue = [""];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      const entries = await readdir(await this.folder(current, root), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const name2 = inFolder(current, entry.name);
        if (entry.isDirectory()) {
          try {
            folderPath(name2, false);
          } catch {
            continue;
          }
          folders.push(name2);
          queue.push(name2);
        } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          try {
            notePath(name2);
          } catch {
            continue;
          }
          notes.push({ name: name2 });
        }
      }
    }
    const compare = (a, b) => a.localeCompare(b, "zh-CN", { numeric: true });
    notes.sort((a, b) => a.name === SAMPLE_NAME ? -1 : b.name === SAMPLE_NAME ? 1 : compare(a.name, b.name));
    folders.sort(compare);
    return { notes, folders };
  }
  async readNote(name2) {
    const path = await this.regular(name2);
    if ((await lstat(path)).size > MAX_NOTE_BYTES) throw new NotesError("too-large", "\u6587\u6863\u8D85\u8FC7 2 MB\uFF0C\u8BF7\u4F7F\u7528\u5916\u90E8\u7F16\u8F91\u5668\u6253\u5F00\u3002");
    return { name: notePath(name2), content: await readFile(path, "utf8") };
  }
  list() {
    return this.serial(async () => {
      await mkdir(this.directory, { recursive: true });
      await this.folder();
      if (this.options.seed) await this.seed();
      return { directory: this.directory, ...await this.tree() };
    });
  }
  async seed() {
    const marker = join3(this.directory, ".dsh-notes-welcome-v1");
    try {
      await lstat(marker);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await writeFile(join3(this.directory, SAMPLE_NAME), SAMPLE_CONTENT, { flag: "wx", encoding: "utf8" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    try {
      await writeFile(marker, "1\n", { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  read(name2) {
    return this.serial(() => this.readNote(name2));
  }
  create(input) {
    return this.serial(async () => {
      const name2 = notePath(input);
      await mkdir(this.directory, { recursive: true });
      const folder = await this.folder(parentFolder(name2));
      await writeFile(join3(folder, baseName(name2)), "", { flag: "wx", encoding: "utf8" });
      return { name: name2, content: "" };
    });
  }
  save(name2, content, previous) {
    return this.serial(async () => {
      if (typeof content !== "string" || typeof previous !== "string") throw new NotesError("invalid-content", "\u6587\u6863\u5185\u5BB9\u5FC5\u987B\u662F\u6587\u672C\u3002");
      if (Buffer.byteLength(content, "utf8") > MAX_NOTE_BYTES) throw new NotesError("too-large", "\u5355\u7BC7\u7B14\u8BB0\u6700\u5927\u652F\u6301 2 MB\u3002");
      const path = await this.regular(name2);
      const current = await readFile(path, "utf8");
      if (current === content) return { name: notePath(name2), content };
      if (current !== previous) throw new NotesError("conflict", "\u6587\u4EF6\u5DF2\u88AB\u5176\u4ED6\u7A97\u53E3\u6216\u7F16\u8F91\u5668\u4FEE\u6539\u3002\u5F53\u524D\u8349\u7A3F\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u5148\u5C06\u8349\u7A3F\u53E6\u5B58\u4E3A\u65B0\u7B14\u8BB0\u3002");
      const temporary = join3(this.directory, `.dsh-notes-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, content, { flag: "wx", encoding: "utf8" });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      return { name: notePath(name2), content };
    });
  }
  rename(name2, input) {
    return this.serial(async () => {
      const nextName = notePath(input);
      const source = await this.regular(name2);
      if (notePath(name2) === nextName) return this.readNote(name2);
      const destination = join3(await this.folder(parentFolder(nextName)), baseName(nextName));
      await link(source, destination);
      try {
        await unlink(source);
      } catch (error) {
        await unlink(destination);
        throw error;
      }
      return this.readNote(nextName);
    });
  }
  delete(name2) {
    return this.serial(async () => {
      await unlink(await this.regular(name2));
    });
  }
  createFolder(input) {
    return this.serial(async () => {
      const name2 = folderPath(input, false);
      await mkdir(this.directory, { recursive: true });
      const parent = await this.folder(parentFolder(name2));
      await mkdir(join3(parent, baseName(name2)));
      return name2;
    });
  }
  renameFolder(input, nextInput) {
    return this.serial(async () => {
      const name2 = folderPath(input, false), nextName = folderPath(nextInput, false);
      if (parentFolder(name2) !== parentFolder(nextName)) throw new NotesError("invalid-name", "\u6587\u4EF6\u5939\u91CD\u547D\u540D\u4E0D\u80FD\u66F4\u6539\u5176\u7236\u76EE\u5F55\u3002");
      const source = await this.folder(name2);
      if (name2 === nextName) return name2;
      const destination = join3(await this.folder(parentFolder(nextName)), baseName(nextName));
      try {
        await lstat(destination);
        throw new NotesError("EEXIST", "\u5DF2\u5B58\u5728\u540C\u540D\u6587\u4EF6\u6216\u6587\u4EF6\u5939\u3002");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await rename(source, destination);
      return nextName;
    });
  }
  deleteFolder(input) {
    return this.serial(async () => {
      await rmdir(await this.folder(folderPath(input, false)));
    });
  }
  importFiles(files, folder = "") {
    return this.serial(async () => {
      if (!Array.isArray(files) || files.length === 0 || files.length > MAX_IMPORT_FILES) throw new NotesError("invalid-import", "\u6BCF\u6B21\u53EF\u5BFC\u5165 1\uFF5E20 \u7BC7 Markdown \u6587\u6863\u3002");
      let total = 0;
      const normalized = files.map((file) => {
        if (!file || typeof file.name !== "string" || !/\.(md|markdown)$/i.test(file.name) || typeof file.content !== "string") throw new NotesError("invalid-import", "\u4EC5\u652F\u6301 UTF-8 \u7F16\u7801\u7684 .md \u6216 .markdown \u6587\u6863\u3002");
        const bytes = Buffer.byteLength(file.content, "utf8");
        total += bytes;
        if (bytes > MAX_NOTE_BYTES) throw new NotesError("too-large", `${file.name} \u8D85\u8FC7\u5355\u7BC7 2 MB \u7684\u9650\u5236\u3002`);
        return { name: noteName(file.name.replace(/\.markdown$/i, ".md")), content: file.content };
      });
      if (total > MAX_IMPORT_BYTES) throw new NotesError("too-large", "\u5355\u6B21\u5BFC\u5165\u603B\u5927\u5C0F\u4E0D\u80FD\u8D85\u8FC7 20 MB\u3002");
      await mkdir(this.directory, { recursive: true });
      const destination = await this.folder(folder);
      const notes = [];
      const errors = [];
      for (const file of normalized) {
        let candidate = file.name;
        let suffix = 1;
        while (true) {
          try {
            await writeImportedFile(join3(destination, candidate), file.content);
            notes.push({ name: inFolder(folder, candidate) });
            break;
          } catch (error) {
            if (error.code === "EEXIST") {
              candidate = `${file.name.slice(0, -3).slice(0, 160)} (${++suffix}).md`;
              continue;
            }
            errors.push(`${file.name}\uFF1A\u5BFC\u5165\u5931\u8D25\uFF08${error.code ?? "\u78C1\u76D8\u8BFB\u5199\u9519\u8BEF"}\uFF09`);
            break;
          }
        }
      }
      return { notes, errors };
    });
  }
  migrate(input) {
    return this.serial(async () => {
      if (typeof input !== "string" || !isAbsolute(input.trim())) throw new NotesError("invalid-directory", "\u8BF7\u9009\u62E9\u6216\u8F93\u5165\u5B8C\u6574\u7684\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84\u3002");
      const source = resolve3(this.directory), requested = resolve3(input.trim());
      const nested = (parent, child) => {
        const rel = relative(parent, child);
        return rel === "" || !rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel);
      };
      if (source === requested) return { directory: source, previousDirectory: source, moved: 0, oldDirectoryRemoved: false, warnings: [] };
      if ([source, requested].some((path) => path === parse(path).root || path === resolve3(homedir2()))) throw new NotesError("invalid-directory", "\u8BF7\u4F7F\u7528\u4E13\u95E8\u7684\u7B14\u8BB0\u6587\u4EF6\u5939\uFF0C\u4E0D\u80FD\u9009\u62E9\u78C1\u76D8\u6839\u76EE\u5F55\u6216\u7528\u6237\u4E3B\u76EE\u5F55\u3002");
      if (nested(source, requested) || nested(requested, source)) throw new NotesError("nested-directory", "\u65B0\u65E7\u7B14\u8BB0\u76EE\u5F55\u4E0D\u80FD\u4E92\u4E3A\u7236\u5B50\u76EE\u5F55\u3002");
      await mkdir(source, { recursive: true });
      if ((await lstat(source)).isSymbolicLink()) throw new NotesError("linked-directory", "\u65E7\u76EE\u5F55\u662F\u94FE\u63A5\u6216\u8054\u63A5\u70B9\uFF0C\u8BF7\u5148\u6539\u4E3A\u666E\u901A\u6587\u4EF6\u5939\u3002");
      let createdTarget = false;
      try {
        await mkdir(requested);
        createdTarget = true;
      } catch (error) {
        if (error.code === "ENOENT") {
          await mkdir(requested, { recursive: true });
          createdTarget = true;
        } else if (error.code !== "EEXIST") throw error;
      }
      const copied = [], createdFolders = [];
      let committed = false;
      try {
        const targetInfo = await lstat(requested);
        if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) throw new NotesError("linked-directory", "\u65B0\u76EE\u5F55\u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\u5939\uFF0C\u4E0D\u80FD\u662F\u94FE\u63A5\u6216\u8054\u63A5\u70B9\u3002");
        const [realSource, target] = await Promise.all([realpath(source), realpath(requested)]);
        if (nested(realSource, target) || nested(target, realSource)) throw new NotesError("nested-directory", "\u65B0\u65E7\u76EE\u5F55\u5B9E\u9645\u6307\u5411\u76F8\u540C\u4F4D\u7F6E\u6216\u4E92\u4E3A\u7236\u5B50\u76EE\u5F55\u3002");
        if (this.options.settingsFile && (nested(realSource, resolve3(this.options.settingsFile)) || nested(target, resolve3(this.options.settingsFile)))) throw new NotesError("settings-directory", "\u8BF7\u5C06\u7B14\u8BB0\u76EE\u5F55\u4E0E\u63D2\u4EF6\u8BBE\u7F6E\u6587\u4EF6\u6240\u5728\u76EE\u5F55\u5206\u5F00\u3002");
        const tree = await this.tree(source);
        const managed = [...tree.notes];
        const marker = ".dsh-notes-welcome-v1";
        try {
          const info = await lstat(join3(source, marker));
          if (info.isFile() && !info.isSymbolicLink()) managed.push({ name: marker });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        const orderedFolders = [...tree.folders].sort((a, b) => a.split("/").length - b.split("/").length);
        for (const folder of orderedFolders) {
          await this.folder(parentFolder(folder), target);
          try {
            await mkdir(join3(target, folder));
            createdFolders.push(join3(target, folder));
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
          }
          await this.folder(folder, target);
        }
        let existingMarker = false;
        for (const entry of managed) {
          try {
            const info = await lstat(join3(target, entry.name));
            if (entry.name === marker && info.isFile() && !info.isSymbolicLink()) {
              existingMarker = true;
              continue;
            }
            throw new NotesError("migration-conflict", `\u76EE\u6807\u76EE\u5F55\u5DF2\u6709\u540C\u540D\u6587\u4EF6\uFF1A${entry.name}\u3002\u8BF7\u66F4\u6362\u76EE\u5F55\u6216\u5148\u5904\u7406\u540C\u540D\u6587\u4EF6\u3002`);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
        const originals = [];
        for (const entry of managed) {
          await this.folder(parentFolder(entry.name), source);
          await this.folder(parentFolder(entry.name), target);
          const from2 = join3(source, entry.name), to = join3(target, entry.name);
          const before = await lstat(from2);
          if (!before.isFile() || before.isSymbolicLink()) throw new NotesError("migration-changed", "\u8FC1\u79FB\u671F\u95F4\u6587\u4EF6\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5\u3002");
          if (entry.name !== marker || !existingMarker) {
            await copyFile(from2, to, constants.COPYFILE_EXCL);
            copied.push(to);
            const after = await lstat(from2), destination = await lstat(to);
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || destination.size !== before.size) throw new NotesError("migration-changed", `${entry.name} \u5728\u590D\u5236\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u8FC1\u79FB\u3002`);
          }
          originals.push({ name: entry.name, size: before.size, mtimeMs: before.mtimeMs });
        }
        await this.options.persistDirectory?.(target);
        this.currentDirectory = target;
        committed = true;
        const warnings = [];
        for (const original of originals) {
          const path = join3(source, original.name);
          try {
            await this.folder(parentFolder(original.name), source);
            const current = await lstat(path);
            if (!current.isFile() || current.isSymbolicLink() || current.size !== original.size || current.mtimeMs !== original.mtimeMs) {
              warnings.push(`${original.name} \u5728\u8FC1\u79FB\u671F\u95F4\u88AB\u4FEE\u6539\uFF0C\u65E7\u6587\u4EF6\u5DF2\u4FDD\u7559\u3002`);
              continue;
            }
            await unlink(path);
          } catch (error) {
            if (error.code !== "ENOENT") warnings.push(`${original.name} \u7684\u65E7\u526F\u672C\u672A\u80FD\u5220\u9664\u3002`);
          }
        }
        for (const folder of orderedFolders.reverse()) {
          try {
            await rmdir(await this.folder(folder, source));
          } catch (error) {
            if (error.code !== "ENOENT") warnings.push(`${folder} \u4ECD\u6709\u5176\u4ED6\u5185\u5BB9\u6216\u65E0\u6CD5\u5220\u9664\uFF0C\u65E7\u6587\u4EF6\u5939\u5DF2\u4FDD\u7559\u3002`);
          }
        }
        let oldDirectoryRemoved = false;
        try {
          await rmdir(source);
          oldDirectoryRemoved = true;
        } catch (error) {
          warnings.push(error.code === "ENOTEMPTY" ? "\u65E7\u76EE\u5F55\u8FD8\u6709\u5176\u4ED6\u6587\u4EF6\u6216\u5B50\u6587\u4EF6\u5939\uFF0C\u5DF2\u4FDD\u7559\u65E7\u76EE\u5F55\u3002" : "\u65E7\u76EE\u5F55\u6682\u65F6\u65E0\u6CD5\u5220\u9664\uFF0C\u5DF2\u4FDD\u7559\u3002");
        }
        return { directory: target, previousDirectory: source, moved: originals.filter((e) => /\.md$/i.test(e.name)).length, oldDirectoryRemoved, warnings };
      } catch (error) {
        if (!committed) {
          for (const path of copied) await unlink(path).catch(() => {
          });
          for (const path of createdFolders.reverse()) await rmdir(path).catch(() => {
          });
          if (createdTarget) await rmdir(requested).catch(() => {
          });
        }
        throw error;
      }
    });
  }
};

// src/settings.ts
import { mkdir as mkdir2, readFile as readFile2, rename as rename2, writeFile as writeFile2, unlink as unlink2 } from "node:fs/promises";
import { dirname as dirname2, isAbsolute as isAbsolute2, join as join4 } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
var NotesSettings = class {
  constructor(file = join4(notesDataDirectory(), "settings.json")) {
    this.file = file;
  }
  async directory(fallback) {
    try {
      const value = JSON.parse(await readFile2(this.file, "utf8"));
      if (typeof value.directory !== "string" || !isAbsolute2(value.directory)) throw new Error("\u7B14\u8BB0\u76EE\u5F55\u914D\u7F6E\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5 " + this.file);
      return value.directory;
    } catch (error) {
      if (error.code === "ENOENT") return fallback ?? join4(dirname2(this.file), "notes");
      throw error;
    }
  }
  async saveDirectory(directory) {
    await mkdir2(dirname2(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID2()}.tmp`;
    try {
      await writeFile2(temporary, JSON.stringify({ directory }, null, 2) + "\n", { flag: "wx", encoding: "utf8" });
      await rename2(temporary, this.file);
    } finally {
      await unlink2(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
};

// src/version.ts
var PLUGIN_VERSION = "0.5.4";

// src/host.ts
var name = "markdown-notes";
var inject = ["connection"];
var Config = Schema.object({
  directory: Schema.string().default("").description("\u9996\u6B21\u4F7F\u7528\u7684\u7B14\u8BB0\u76EE\u5F55\u3002\u540E\u7EED\u8BF7\u5728\u7B14\u8BB0\u9875\u7684\u201C\u4FDD\u5B58\u4F4D\u7F6E\u201D\u4E2D\u8FC1\u79FB\u76EE\u5F55\uFF1B\u8FC1\u79FB\u540E\u7684\u8DEF\u5F84\u4F18\u5148\u4E8E\u6B64\u521D\u59CB\u503C\u3002")
});
function createHandler(store) {
  return async (request) => {
    const headers = { "Cache-Control": "no-store", "X-DSH-Notes-Version": PLUGIN_VERSION };
    try {
      const clientVersion = request.headers.get("X-DSH-Notes-Client-Version");
      if (clientVersion !== PLUGIN_VERSION) throw new NotesError("version-mismatch", `\u7B14\u8BB0\u524D\u540E\u7AEF\u7248\u672C\u4E0D\u4E00\u81F4\uFF1A\u9875\u9762 ${clientVersion ?? "\u672A\u62A5\u544A\u7248\u672C\uFF08\u53EF\u80FD\u4ECD\u4E3A\u65E7\u7248\uFF09"}\uFF0C\u5BBF\u4E3B ${PLUGIN_VERSION}\u3002\u8BF7\u786E\u8BA4\u5DF2\u5B89\u88C5\u540C\u4E00\u7248\u672C\u63D2\u4EF6\u5E76\u5B8C\u6574\u9000\u51FA\u3001\u91CD\u65B0\u542F\u52A8 DSH\u3002`);
      const body = await request.json();
      if (!body || typeof body !== "object") throw new NotesError("bad-request", "\u8BF7\u6C42\u683C\u5F0F\u4E0D\u6B63\u786E\u3002");
      let data;
      switch (body.action) {
        case "list":
          data = await store.list();
          break;
        case "read":
          data = await store.read(body.name);
          break;
        case "create":
          data = await store.create(body.name);
          break;
        case "save":
          data = await store.save(body.name, body.content, body.previous);
          break;
        case "rename":
          data = await store.rename(body.name, body.nextName);
          break;
        case "delete":
          await store.delete(body.name);
          data = null;
          break;
        case "create-folder":
          data = await store.createFolder(body.name);
          break;
        case "rename-folder":
          data = await store.renameFolder(body.name, body.nextName);
          break;
        case "delete-folder":
          await store.deleteFolder(body.name);
          data = null;
          break;
        case "import":
          data = await store.importFiles(body.files, body.folder);
          break;
        case "migrate":
          data = await store.migrate(body.directory);
          break;
        default:
          throw new NotesError("bad-request", `\u5BBF\u4E3B ${PLUGIN_VERSION} \u4E0D\u652F\u6301\u7B14\u8BB0\u64CD\u4F5C\u300C${String(body.action).slice(0, 60)}\u300D\u3002\u8BF7\u6838\u5BF9\u63D2\u4EF6\u7248\u672C\u3002`);
      }
      return Response.json({ data }, { headers });
    } catch (error) {
      const code = error instanceof NotesError ? error.code : error.code ?? "io-error";
      const messages = {
        ENOENT: "\u6587\u6863\u6216\u6587\u4EF6\u5939\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5237\u65B0\u5217\u8868\u3002",
        EEXIST: "\u5DF2\u5B58\u5728\u540C\u540D\u6587\u6863\u6216\u6587\u4EF6\u5939\uFF0C\u8BF7\u6362\u4E00\u4E2A\u540D\u79F0\u3002",
        ENOTEMPTY: "\u6587\u4EF6\u5939\u4E0D\u4E3A\u7A7A\uFF0C\u8BF7\u5148\u79FB\u8D70\u6216\u5220\u9664\u91CC\u9762\u7684\u5185\u5BB9\u3002",
        ENOTDIR: "\u8DEF\u5F84\u4E0D\u662F\u6587\u4EF6\u5939\uFF0C\u8BF7\u5237\u65B0\u5217\u8868\u3002",
        EACCES: "\u65E0\u6CD5\u8BFB\u5199\u7B14\u8BB0\u76EE\u5F55\uFF0C\u8BF7\u68C0\u67E5\u76EE\u5F55\u6743\u9650\u3002",
        EPERM: "\u6587\u4EF6\u88AB\u5360\u7528\u6216\u6CA1\u6709\u64CD\u4F5C\u6743\u9650\uFF0C\u8BF7\u5173\u95ED\u5176\u4ED6\u7F16\u8F91\u5668\u540E\u91CD\u8BD5\u3002",
        ENOSPC: "\u78C1\u76D8\u7A7A\u95F4\u4E0D\u8DB3\uFF0C\u8349\u7A3F\u5C1A\u672A\u4FDD\u5B58\u3002"
      };
      const message = error instanceof NotesError ? error.message : messages[code] ?? "\u8BFB\u5199\u7B14\u8BB0\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u76EE\u5F55\u548C\u78C1\u76D8\u540E\u91CD\u8BD5\u3002";
      return Response.json({ error: { code, message } }, { status: code === "conflict" || code === "EEXIST" || code === "version-mismatch" ? 409 : 400, headers });
    }
  };
}
async function apply(ctx, config = {}, settings = new NotesSettings()) {
  const store = new NotesStore(await settings.directory(config.directory?.trim() || void 0), {
    seed: true,
    persistDirectory: (directory) => settings.saveDirectory(directory),
    settingsFile: settings.file
  });
  ctx.connection.fetch.register({ path: API_PATH, methods: ["POST"], requestBody: "buffered", fetch: createHandler(store) });
}
export {
  Config,
  NotesSettings,
  apply,
  createHandler,
  inject,
  name
};
