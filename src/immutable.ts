/** Freeze trusted registry data once so SDK consumers cannot alter runtime policy. */
export function freezeRegistry<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeRegistry(child);
    Object.freeze(value);
  }
  return value;
}
