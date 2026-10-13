/**
 * Конкретные имена инструментов в коде внутри строки или в полях name JSON.
 * Семейства с подстановкой и сводки — не вызовы.
 */
export function documentedMcpToolNames(markdown) {
  const names = new Set();
  const add = (name) => {
    if (!name.startsWith("hcm_inline_") && !name.endsWith("_")) names.add(name);
  };
  const jsonNames = (source) => {
    for (const match of source.matchAll(/"name"\s*:\s*"(hcm_[a-z][a-z0-9_]*)"/g)) add(match[1]);
  };
  const withoutFences = markdown.replace(
    /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\s*$/gm,
    (_match, _fence, body) => {
      jsonNames(body);
      return "";
    },
  );
  for (const match of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    jsonNames(match[1]);
    for (const candidate of match[1].matchAll(/\bhcm_[a-z][a-z0-9_]*\b/g)) {
      const end = candidate.index + candidate[0].length;
      if (match[1][end] !== "*") add(candidate[0]);
    }
  }
  return [...names].sort();
}

export function unknownDocumentedMcpTools(markdown, knownNames) {
  return documentedMcpToolNames(markdown).filter((name) => !knownNames.has(name));
}
