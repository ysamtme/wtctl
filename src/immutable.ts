/** Один раз замораживает доверенные данные реестра: потребителям SDK не изменить права runtime. */
export function freezeRegistry<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeRegistry(child);
    Object.freeze(value);
  }
  return value;
}
