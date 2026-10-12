import { findXmlNode, parseXml } from "./xml.js";

export interface LibraryFunction {
  readonly id: string;
  readonly parameters: readonly string[];
  readonly allowed: boolean;
  /** Declared without the client gate: server code can call it, a client cannot. */
  readonly serverOnly?: true;
  readonly code: string;
}
type Data = Record<string, unknown>;
type SharedFile = { id: string; url: string };

/** XMD repeats PARAM; libraries also repeat flags. Normalize attributes, preserving EXPR literals. */
export function normalizeFormParams(source: string, library = false): string {
  return source.replace(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^<>"']|"[^"]*"|'[^']*')+>/g,
    (tag) => {
      if (/^<[!?\/]/.test(tag)) return tag;
      const counts = new Map<string, number>();
      return tag.replace(/\s+([^\s=/>]+)\s*=\s*(?:"[^"]*"|'[^']*')/g, (attribute, name: string) => {
        const key = name.toUpperCase();
        const count = counts.get(key) ?? 0;
        counts.set(key, count + 1);
        if (key === "PARAM") return attribute.replace(name, `PARAM__${count}`);
        if (library && count) attribute = attribute.replace(name, `${name}__${count}`);
        return key === "EXPR"
          ? attribute.replace(/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/g, "&amp;")
          : attribute;
      });
    },
  );
}

/** Reads library declarations as data, without evaluating their expressions. */
export class LibraryReader {
  private shared: Promise<SharedFile[] | undefined> | undefined;
  private files = new Map<string, Promise<LibraryFunction[] | undefined>>();
  constructor(
    private applicationInfo: () => Promise<Data>,
    private readFile: (url: string) => Promise<unknown>,
  ) {}
  private file({ url }: SharedFile): Promise<LibraryFunction[] | undefined> {
    let cached = this.files.get(url);
    if (!cached) {
      cached = this.readFile(url)
        .catch((error: unknown) => {
          this.files.delete(url); // An unread file is requested again by the next call.
          throw error;
        })
        .then((response) => {
          const encoded = findXmlNode(response, "Data");
          if (typeof encoded !== "string") throw new Error();
          const source = new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.from(encoded, "base64"),
          );
          const root = findXmlNode(
            parseXml(normalizeFormParams(source, true)),
            "SPXML-INLINE-FORM",
          );
          if (root === undefined) return []; // Shared forms and data are not libraries.
          if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error();
          return Object.values(root).flatMap((library) => {
            if (!library || typeof library !== "object" || Array.isArray(library)) return [];
            return Object.entries(library).flatMap(([method, value]) => {
              const attributes = value as Data | null;
              const gate = attributes?.["@_ALLOW-CALL-FROM-CLIENT"];
              // A property with a body is a function; the gate decides who may call it.
              const serverOnly =
                gate === undefined &&
                attributes?.["@_PROPERTY"] === "1" &&
                attributes["@_EXPR"] !== undefined;
              if (gate === undefined && !serverOnly) return [];
              return [
                {
                  id: method,
                  parameters: Object.entries(attributes!)
                    .filter(([key]) => /^@_PARAM__\d+$/.test(key))
                    .map(([, value]) => String(value)),
                  allowed: gate === "1",
                  ...(serverOnly ? { serverOnly: true as const } : {}),
                  code: String(attributes?.["@_EXPR"] ?? ""),
                },
              ];
            });
          });
        })
        .catch(() => undefined);
      this.files.set(url, cached);
    }
    return cached;
  }
  async read(
    library?: string,
  ): Promise<{ targets: LibraryFunction[]; skipped: string[] } | undefined> {
    this.shared ??= this.applicationInfo()
      .then((info) => {
        if (!Array.isArray(info.shared_docs)) throw new Error();
        return (info.shared_docs as SharedFile[]).filter((file) => {
          if (!file || typeof file.id !== "string" || typeof file.url !== "string") return false;
          try {
            const url = new URL(file.url);
            return (
              url.hostname.toLowerCase() !== String(info.default_db_name).toLowerCase() &&
              !(url.protocol === "x-local:" && url.hostname === "data_local")
            );
          } catch {
            return true;
          }
        });
      })
      .catch(() => {
        this.shared = undefined;
        return undefined;
      });
    const shared = await this.shared;
    if (!shared) return undefined;
    const files = shared.filter((file) => library === undefined || file.id === library);
    const targets = new Map<string, LibraryFunction>();
    const skipped = new Set<string>();
    for (let offset = 0; offset < files.length; offset += 4) {
      const batch = files.slice(offset, offset + 4);
      const results = await Promise.all(batch.map((file) => this.file(file)));
      results.forEach((result, index) => {
        if (result === undefined) skipped.add(batch[index]!.id);
        else
          for (const fn of result) {
            const id = `${batch[index]!.id}.${fn.id}`;
            targets.set(id, { ...fn, id });
          }
      });
    }
    return {
      targets: [...targets.values()].sort((a, b) => a.id.localeCompare(b.id)),
      skipped: [...skipped],
    };
  }
}
