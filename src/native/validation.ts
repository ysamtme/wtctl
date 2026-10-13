import { ArgumentError } from "../protocol/error.js";
import { rawXml, rawXmlElement } from "../protocol/xml.js";

type Schema = Record<string, unknown>;

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    );
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  );
}

/** Небольшой детерминированный валидатор подмножества схем, которое выдаёт генератор объявлений. */
export function validate(value: unknown, schema: Schema, path = "args"): void {
  if ("const" in schema && !sameJson(value, schema.const))
    throw new ArgumentError(`${path}: значение не совпадает с требуемым.`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => sameJson(value, item)))
    throw new ArgumentError(`${path}: такого значения нет среди допустимых.`);
  if (Array.isArray(schema.anyOf)) {
    for (const option of schema.anyOf) {
      try {
        validate(value, option as Schema, path);
        return;
      } catch {
        /* дальше — другой объявленный вариант */
      }
    }
    throw new ArgumentError(`${path}: значение не подходит ни под один из допустимых вариантов.`);
  }
  if (schema.type === "string") {
    if (typeof value !== "string") throw new ArgumentError(`${path}: нужна строка.`);
    const length = Array.from(value).length;
    if (typeof schema.minLength === "number" && length < schema.minLength)
      throw new ArgumentError(`${path}: строка короче допустимого.`);
    if (typeof schema.maxLength === "number" && length > schema.maxLength)
      throw new ArgumentError(`${path}: строка длиннее допустимого.`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value))
      throw new ArgumentError(`${path}: значение записано неверно.`);
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new ArgumentError(`${path}: нужно число.`);
    if (schema.type === "integer" && !Number.isInteger(value))
      throw new ArgumentError(`${path}: нужно целое число.`);
    if (typeof schema.minimum === "number" && value < schema.minimum)
      throw new ArgumentError(`${path}: число меньше допустимого, не меньше ${schema.minimum}.`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      throw new ArgumentError(`${path}: число больше допустимого, не больше ${schema.maximum}.`);
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum)
      throw new ArgumentError(`${path}: число меньше допустимого.`);
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum)
      throw new ArgumentError(`${path}: число больше допустимого.`);
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw new ArgumentError(`${path}: нужно true или false.`);
  } else if (schema.type === "null") {
    if (value !== null) throw new ArgumentError(`${path}: нужно null.`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) throw new ArgumentError(`${path}: нужен массив.`);
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      throw new ArgumentError(`${path}: в массиве меньше элементов, чем нужно.`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      throw new ArgumentError(`${path}: в массиве больше элементов, чем допустимо.`);
    for (const [index, item] of value.entries())
      validate(item, (schema.items ?? {}) as Schema, `${path}[${index}]`);
  } else if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new ArgumentError(`${path}: нужен объект.`);
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required ?? []) as string[])
      if (!Object.hasOwn(object, key) || object[key] === undefined)
        throw new ArgumentError(`${path}.${key}: обязательное значение не задано.`);
    for (const [key, child] of Object.entries(object)) {
      const childSchema = Object.hasOwn(properties, key) ? properties[key] : undefined;
      if (childSchema) validate(child, childSchema, `${path}.${key}`);
      else if (schema.additionalProperties === false)
        throw new ArgumentError(`${path}.${key}: такого аргумента у операции нет.`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object")
        validate(child, schema.additionalProperties as Schema, `${path}.${key}`);
    }
  }
}

function normalized(value: unknown, schema: Schema): unknown {
  if (Array.isArray(schema.anyOf)) {
    let matchError: unknown;
    let normalizationError: unknown;
    for (const option of schema.anyOf) {
      try {
        validate(value, option as Schema);
      } catch (error) {
        matchError = error;
        continue;
      }
      try {
        return normalized(value, option as Schema);
      } catch (error) {
        normalizationError ??= error;
      }
    }
    const error = normalizationError ?? matchError;
    throw error instanceof Error
      ? error
      : new ArgumentError("Аргументы не подходят ни под один из допустимых вариантов.");
  }
  if (schema["x-normalization"] === "xml") return rawXml(value as string);
  if (schema["x-normalization"] === "xml-box") return rawXml((value as { xml: string }).xml);
  if (schema["x-normalization"] === "xml-element") return rawXmlElement(value as string);
  if (schema["x-normalization"] === "xml-element-box")
    return rawXmlElement((value as { xml: string }).xml);
  if (schema["x-normalization"] === "binary") {
    const encoded = (value as { base64: string }).base64;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
      throw new ArgumentError("Значение base64 записано неверно.");
    return new Uint8Array(Buffer.from(encoded, "base64"));
  }
  if (schema.type === "array")
    return (value as unknown[]).map((item) => normalized(item, (schema.items ?? {}) as Schema));
  if (schema.type === "object" && value && typeof value === "object") {
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalized(child, Object.hasOwn(properties, key) ? properties[key]! : {}),
      ]),
    );
  }
  return value;
}

export function prepare(value: Record<string, unknown>, schema: Schema): Record<string, unknown> {
  validate(value, schema);
  return normalized(value, schema) as Record<string, unknown>;
}
