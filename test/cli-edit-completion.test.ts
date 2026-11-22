import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import test from "node:test";
import { generateCompletion, readConnectionNamesForCompletion } from "../src/cli/completion.js";
import { renderLineDiff } from "../src/cli/diff.js";
import { diffObjectFields, safeTempFileName } from "../src/cli/edit.js";
import { createStyler, stripAnsi } from "../src/cli/format/ansi.js";
import { cliHelp } from "../src/cli/help.js";
import { launchEditor, parseEditorCommand, resolveEditorCommand } from "../src/cli/node-io.js";
import { runCli } from "../src/cli/run.js";
import type { CliDependencies, CliIo, RuntimePort } from "../src/cli/types.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { HcmError } from "../src/errors.js";
import { XmlDocument } from "../src/documents.js";
import { scratchRuntimeDir } from "./fake-server.js";

const BASE_CONFIG: ConnectionConfig = {
  name: "dev",
  baseUrl: "http://hcm.invalid/",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
  outputLimitBytes: 24 * 1024,
  runtimeDir: scratchRuntimeDir,
  permissions: { write: true, execute: true },
};

function okResult(
  operationId: string,
  data: unknown,
  extraMeta: Record<string, unknown> = {},
): OperationResult {
  return {
    ok: true,
    data,
    meta: { operationId, connection: BASE_CONFIG.name, durationMs: 5, ...extraMeta },
  };
}

function errResult(operationId: string, code: string, message: string): OperationResult {
  return {
    ok: false,
    error: { code, message, retryable: false },
    meta: { operationId, connection: BASE_CONFIG.name, durationMs: 5 },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface HarnessOptions {
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  color?: boolean;
  confirm?: boolean | ((question: string) => boolean | Promise<boolean>);
  launchEditor?: (
    command: string | undefined,
    filePath: string,
    options?: { readonly redirectStdoutToStderr?: boolean },
  ) => Promise<number>;
  readFile?: (path: string) => Promise<string>;
  results?: RuntimePort["results"];
  reply?: (
    id: string,
    args: Record<string, unknown>,
    callIndex: number,
  ) => OperationResult | Promise<OperationResult>;
}

function harness(options: HarnessOptions = {}) {
  const state = {
    stdout: "",
    stderr: "",
    closes: 0,
    confirmQuestions: [] as string[],
    editorCalls: [] as { command: string | undefined; filePath: string }[],
    calls: [] as { id: string; args: Record<string, unknown> }[],
    files: new Map<string, string>(),
  };

  const confirmFn =
    options.confirm === undefined
      ? undefined
      : async (question: string) => {
          state.confirmQuestions.push(question);
          return typeof options.confirm === "function"
            ? await options.confirm(question)
            : options.confirm!;
        };

  const launchEditorFn =
    options.launchEditor === undefined
      ? undefined
      : async (
          command: string | undefined,
          filePath: string,
          launchOpts?: { readonly redirectStdoutToStderr?: boolean },
        ) => {
          state.editorCalls.push({ command, filePath });
          return await options.launchEditor!(command, filePath, launchOpts);
        };

  const io: CliIo = {
    ...(options.stdoutIsTTY === undefined ? {} : { stdoutIsTTY: options.stdoutIsTTY }),
    ...(options.stderrIsTTY === undefined ? {} : { stderrIsTTY: options.stderrIsTTY }),
    ...(options.color === undefined ? {} : { color: options.color }),
    ...(confirmFn === undefined ? {} : { confirm: confirmFn }),
    ...(launchEditorFn === undefined ? {} : { launchEditor: launchEditorFn }),
    pretty: options.stdoutIsTTY === true,
    writeOut: (text) => {
      state.stdout += text;
    },
    writeError: (text) => {
      state.stderr += text;
    },
    readFile:
      options.readFile ??
      (async (path) => {
        if (state.files.has(path)) return state.files.get(path)!;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT", syscall: "open" });
      }),
    readStdin: async () => "{}",
    writeFile: async (path, text) => {
      state.files.set(path, text);
    },
  };

  const runtime: RuntimePort = {
    ...(options.results === undefined ? {} : { results: options.results }),
    listOperations: () => ({ operations: [], total: 0 }),
    describe: () => {
      throw new Error("Не ожидалось в подставном тесте");
    },
    getOperationEffect: () => "read",
    call: async (id, args = {}) => {
      const idx = state.calls.length;
      state.calls.push({ id, args });
      if (options.reply) return await options.reply(id, args, idx);
      return okResult(id, {});
    },
    close: async () => {
      state.closes++;
    },
  };

  const dependencies: CliDependencies = {
    loadConfiguration: () => BASE_CONFIG,
    createRuntime: () => runtime,
    runMcp: async () => undefined,
  };

  return { io, dependencies, state };
}

test("resolveEditorCommand и parseEditorCommand учитывают приоритет, кавычки и пути Windows", () => {
  assert.equal(
    resolveEditorCommand(
      "nano",
      { WTCTL_EDITOR: "code --wait", VISUAL: "vim", EDITOR: "ed" },
      "linux",
    ),
    "nano",
  );
  assert.equal(
    resolveEditorCommand(
      "  ",
      { WTCTL_EDITOR: "code --wait", VISUAL: "vim", EDITOR: "ed" },
      "linux",
    ),
    "code --wait",
  );
  assert.equal(resolveEditorCommand(undefined, { VISUAL: "vim", EDITOR: "ed" }, "linux"), "vim");
  assert.equal(resolveEditorCommand(undefined, { VISUAL: "", EDITOR: "ed" }, "linux"), "ed");
  assert.equal(resolveEditorCommand(undefined, {}, "win32"), "notepad");
  assert.equal(resolveEditorCommand(undefined, {}, "linux"), "vi");

  assert.deepEqual(parseEditorCommand("code --wait", "win32"), ["code", "--wait"]);
  assert.deepEqual(
    parseEditorCommand('"C:\\Program Files\\Microsoft VS Code\\Code.exe" --wait', "win32"),
    ["C:\\Program Files\\Microsoft VS Code\\Code.exe", "--wait"],
  );
  assert.deepEqual(
    parseEditorCommand("'C:\\Program Files\\Notepad++\\notepad++.exe' -multiInst", "win32"),
    ["C:\\Program Files\\Notepad++\\notepad++.exe", "-multiInst"],
  );
  assert.deepEqual(parseEditorCommand("C:\\Windows\\System32\\notepad.exe", "win32"), [
    "C:\\Windows\\System32\\notepad.exe",
  ]);
  assert.deepEqual(parseEditorCommand('node -e "console.log(\\"ok\\")"', "win32"), [
    "node",
    "-e",
    'console.log("ok")',
  ]);
  assert.deepEqual(parseEditorCommand("/usr/local/My\\ Editor/edit --wait", "linux"), [
    "/usr/local/My Editor/edit",
    "--wait",
  ]);

  assert.throws(
    () => parseEditorCommand("   "),
    (error: unknown) => {
      assert.ok(error instanceof HcmError);
      assert.equal(error.code, "EDITOR_FAILED");
      return true;
    },
  );
  assert.throws(() => parseEditorCommand('"C:\\Program Files\\code.exe'), {
    code: "EDITOR_FAILED",
  });
  assert.throws(() => parseEditorCommand("'unclosed"), { code: "EDITOR_FAILED" });
});

test("launchEditor запускает внешний процесс без shell и возвращает понятную ошибку при ENOENT", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-editor-launch-"));
  try {
    const file = join(dir, "sample.txt");
    await writeFile(file, "до", "utf8");
    const script = join(dir, "write.cjs");
    await writeFile(
      script,
      'const fs = require("node:fs"); fs.writeFileSync(process.argv[2], "после", "utf8");',
      "utf8",
    );
    const code = await launchEditor(`"${process.execPath}" "${script}"`, file);
    assert.equal(code, 0);
    assert.equal(await readFile(file, "utf8"), "после");

    if (process.platform === "win32") {
      const cmdFile = join(dir, "test editor.cmd");
      await writeFile(
        cmdFile,
        `@echo off\r\n"${process.execPath}" -e "require('node:fs').writeFileSync(process.argv[2], process.argv[1], 'utf8')" -- %*\r\n`,
        "utf8",
      );
      const cmdCode = await launchEditor(`"${cmdFile}" "cmd&safe%PATH%"`, file);
      assert.equal(cmdCode, 0);
      assert.equal(await readFile(file, "utf8"), "cmd&safe%PATH%");
    }

    await assert.rejects(
      launchEditor("wtctl_definitely_missing_editor_bin_999", file),
      (error: unknown) => {
        assert.ok(error instanceof HcmError);
        assert.equal(error.code, "EDITOR_FAILED");
        assert.match(error.hint ?? "", /--editor.*WTCTL_EDITOR.*EDITOR/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderLineDiff строит unified-diff с контекстом, цветами, экранированием и защитой от больших файлов", () => {
  const plain = createStyler(false);
  const colored = createStyler(true);

  assert.equal(renderLineDiff("a\nb\n", "a\nb\n", plain), "");
  assert.match(renderLineDiff("a\nb\n", "a\r\nb\r\n", plain), /только переводы строк/);

  const before = ["1", "2", "3", "4", "старая", "6", "7", "8", "9"].join("\n") + "\n";
  const after = ["1", "2", "3", "4", "новая", "добавлена", "6", "7", "8", "9"].join("\n") + "\n";
  const diff = renderLineDiff(before, after, plain);
  assert.match(diff, /^@@ -2,7 \+2,8 @@/m);
  assert.ok(diff.includes("  2\n  3\n  4\n- старая\n+ новая\n+ добавлена\n  6\n  7\n  8\n"));
  assert.ok(!diff.includes("  1\n"));
  assert.ok(!diff.includes("  9\n"));

  const coloredDiff = renderLineDiff("a\n", "b\n", colored);
  assert.match(coloredDiff, /\x1b\[31m- a\x1b\[39m/);
  assert.match(coloredDiff, /\x1b\[32m\+ b\x1b\[39m/);
  assert.equal(stripAnsi(coloredDiff), "@@ -1,1 +1,1 @@\n- a\n+ b\n");

  // Управляющие символы из серверных данных экранируются и не ломают терминал.
  const injected = renderLineDiff("safe\n", "bad\x1b[31m\x07line\n", plain);
  assert.ok(!injected.includes("\x1b[31m"));
  assert.ok(!injected.includes("\x07"));
  assert.ok(injected.includes("\\x1b[31m\\x07line"));

  // Файл > 4000 строк обрабатывается мгновенно без матрицы O(N×M).
  const bigBefore = Array.from({ length: 4500 }, (_, i) => `line-${i}`).join("\n") + "\n";
  const bigAfterLines = Array.from({ length: 4500 }, (_, i) => `line-${i}`);
  bigAfterLines[10] = "changed-10";
  bigAfterLines[4490] = "changed-4490";
  const t0 = Date.now();
  const bigDiff = renderLineDiff(bigBefore, `${bigAfterLines.join("\n")}\n`, plain);
  assert.ok(Date.now() - t0 < 2000);
  assert.match(bigDiff, /^@@ -8,4487 \+8,4487 @@/m);
  assert.match(bigDiff, /строк удалено пропущено/);
  assert.match(bigDiff, /строк добавлено пропущено/);
});

test("diffObjectFields и safeTempFileName корректно обрабатывают вложенность, массивы, __proto__ и имена файлов", () => {
  assert.deepEqual(
    diffObjectFields({ a: 1, b: { c: "x", d: [1, 2] } }, { a: 1, b: { c: "x", d: [1, 2] } }),
    { patch: {}, remove: [] },
  );

  assert.deepEqual(
    diffObjectFields(
      { id: "0x1", name: "Старое", meta: { a: "1", drop: "yes" }, keep: null, old: "gone" },
      { id: "0x1", name: "Новое", meta: { a: "1", add: "2" }, keep: { nested: true } },
    ),
    {
      patch: { name: "Новое", "meta.add": "2", keep: { nested: true } },
      remove: ["meta.drop", "old"],
    },
  );

  // Ключ с точкой отклоняется с UNSUPPORTED_PATCH_KEY (включая целиком добавляемую структуру).
  assert.throws(() => diffObjectFields({ "a.b": "literal" }, { "a.b": "changed" }), {
    code: "UNSUPPORTED_PATCH_KEY",
  });
  assert.throws(
    () => diffObjectFields({ box: { "a.b": 1, ok: 2 } }, { box: { "a.b": 3, ok: 2 } }),
    {
      code: "UNSUPPORTED_PATCH_KEY",
    },
  );
  assert.throws(() => diffObjectFields({}, { box: { "a.b": "new" } }), {
    code: "UNSUPPORTED_PATCH_KEY",
  });

  // Вложенный массив >1 элемента правится точечно по индексу, сохраняя атрибуты соседних элементов.
  const labelsDoc = XmlDocument.parse(
    '<doc><labels><label>A</label><label>B</label><extra x="keep">stay</extra></labels></doc>',
  );
  const labelsBefore = labelsDoc.snapshot().data;
  const labelsAfter = {
    labels: { label: ["A1", "B"], extra: "stay" },
  };
  const labelsDiff = diffObjectFields(labelsBefore, labelsAfter);
  assert.deepEqual(labelsDiff, { patch: { "labels.label[0]": "A1" }, remove: [] });
  const labelsPatched = labelsDoc.patch(labelsDiff.patch);
  assert.match(labelsPatched.after.xml, /<label>A1<\/label><label>B<\/label>/);
  assert.match(labelsPatched.after.xml, /<extra x="keep">stay<\/extra>/);

  // Расширение списка объектов по уникальному ключу сохраняет атрибуты и комментарии существующих элементов.
  const customDoc = XmlDocument.parse(
    '<doc><custom_elems><custom_elem flag="k1"><!--c1--><name>a</name><value>1</value></custom_elem><custom_elem flag="k2"><!--c2--><name>b</name><value>2</value></custom_elem></custom_elems></doc>',
  );
  const customBefore = customDoc.snapshot().data;
  const customAdd = diffObjectFields(customBefore, {
    custom_elems: {
      custom_elem: [
        { name: "a", value: "1" },
        { name: "b", value: "2" },
        { name: "c", value: "3" },
      ],
    },
  });
  assert.deepEqual(customAdd, {
    patch: { "custom_elems.custom_elem[name=c]": { name: "c", value: "3" } },
    remove: [],
  });
  const afterCustomAdd = customDoc.patch(customAdd.patch).after.xml;
  assert.match(afterCustomAdd, /flag="k1"/);
  assert.match(afterCustomAdd, /<!--c1-->/);
  assert.match(afterCustomAdd, /flag="k2"/);
  assert.match(afterCustomAdd, /<!--c2-->/);
  assert.match(afterCustomAdd, /<name>c<\/name><value>3<\/value>/);

  // Добавление безымянного скаляра в существующий список отклоняется, чтобы не стереть атрибуты/комментарии.
  const entryDoc = XmlDocument.parse(
    '<doc><entry>A</entry><entry attr="keep"><!--c-->B</entry></doc>',
  );
  assert.throws(() => diffObjectFields(entryDoc.snapshot().data, { entry: ["A", "B", "C"] }), {
    code: "UNSUPPORTED_LIST_APPEND",
  });

  const entryDoc2 = XmlDocument.parse("<doc><id>1</id><entry>A</entry><entry>B</entry></doc>");
  const delEntry = diffObjectFields(entryDoc2.snapshot().data, { id: "1" });
  assert.deepEqual(delEntry, { patch: {}, remove: ["entry[1]", "entry[0]"] });
  const afterDel = entryDoc2.patch(delEntry.remove.map((path) => ({ op: "remove", path }))).after
    .xml;
  assert.doesNotMatch(afterDel, /<entry>/);
  assert.match(afterDel, /<id>1<\/id>/);

  // Безопасная обработка __proto__ без загрязнения прототипа.
  const withProto = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
  const protoDiff = diffObjectFields({}, withProto);
  assert.equal(Object.getPrototypeOf(protoDiff.patch), Object.prototype);
  assert.equal(Object.hasOwn(protoDiff.patch, "__proto__"), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);

  // Безопасные имена временных файлов.
  assert.equal(safeTempFileName("x-local://wt/web/custom.js"), "custom.js");
  assert.equal(safeTempFileName("x-local://share/../../etc/passwd"), "passwd");
  assert.equal(safeTempFileName("x-local://share/.."), "file.txt");
  assert.equal(safeTempFileName("x-local://share/CON.txt"), "edit_CON.txt");
  assert.equal(safeTempFileName("x-local://share/a&calc.exe.txt"), "a_calc.exe.txt");
});

test("files edit редактирует текстовый файл с сохранением расширения, подтверждением и уборкой временной папки", async () => {
  let seenTempPath = "";
  const h = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      seenTempPath = filePath;
      assert.equal(basename(filePath), "custom.js");
      assert.equal(extname(filePath), ".js");
      const content = await readFile(filePath, "utf8");
      assert.equal(content, "var a = 1;\n");
      await writeFile(filePath, "var a = 2;\n", "utf8");
      return 0;
    },
    reply: (id, args) => {
      if (id === "files.read") return okResult(id, { text: "var a = 1;\n", bytes: 11 });
      if (id === "files.write") {
        assert.equal(args.url, "x-local://wt/web/custom.js");
        assert.equal(args.text, "var a = 2;\n");
        return okResult(id, { bytes: 11, mutationOutcome: "confirmed" });
      }
      throw new Error(`Неожиданная операция ${id}`);
    },
  });

  const code = await runCli(
    ["files", "edit", "x-local://wt/web/custom.js", "--editor", "code --wait"],
    h.io,
    h.dependencies,
  );
  assert.equal(code, 0, h.state.stderr);
  assert.equal(h.state.editorCalls[0]?.command, "code --wait");
  assert.match(h.state.stderr, /dev \(http:\/\/hcm\.invalid\/\)/);
  assert.match(h.state.stderr, /- var a = 1;/);
  assert.match(h.state.stderr, /\+ var a = 2;/);
  assert.deepEqual(h.state.confirmQuestions, ["Сохранить изменения на сервер? [y/N] "]);
  assert.match(h.state.stdout, /Файл записан/);
  assert.equal(await exists(dirname(seenTempPath)), false);
});

test("files edit: без изменений, отмена, код редактора, --yes, не-TTY, двоичный файл, truncated и --output", async () => {
  // Без изменений в человеческом и JSON-режимах.
  let tempDirUnchanged = "";
  const noChangeHuman = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      tempDirUnchanged = dirname(filePath);
      return 0;
    },
    reply: () => okResult("files.read", { text: "same\n", bytes: 5 }),
  });
  assert.equal(
    await runCli(
      ["files", "edit", "x-local://share/a.txt"],
      noChangeHuman.io,
      noChangeHuman.dependencies,
    ),
    0,
  );
  assert.equal(noChangeHuman.state.stdout, "Изменений нет.\n");
  assert.equal(noChangeHuman.state.calls.length, 1);
  assert.equal(await exists(tempDirUnchanged), false);

  const noChangeJson = harness({
    stdoutIsTTY: false,
    stderrIsTTY: false,
    launchEditor: async () => 0,
    reply: () => okResult("files.read", { text: "same\n", bytes: 5 }),
  });
  assert.equal(
    await runCli(
      ["files", "edit", "x-local://share/a.txt", "--yes", "--json"],
      noChangeJson.io,
      noChangeJson.dependencies,
    ),
    0,
  );
  const jsonBody = JSON.parse(noChangeJson.state.stdout) as OperationResult;
  assert.deepEqual(jsonBody.data, { url: "x-local://share/a.txt", changed: false });

  // Отказ при подтверждении → код 1, без записи, временная папка удалена.
  let tempDirCancel = "";
  const cancelled = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: false,
    launchEditor: async (_cmd, filePath) => {
      tempDirCancel = dirname(filePath);
      await writeFile(filePath, "changed\n", "utf8");
      return 0;
    },
    reply: () => okResult("files.read", { text: "orig\n", bytes: 5 }),
  });
  assert.equal(
    await runCli(["files", "edit", "x-local://share/a.txt"], cancelled.io, cancelled.dependencies),
    1,
  );
  assert.match(cancelled.state.stderr, /Отменено\./);
  assert.equal(cancelled.state.calls.length, 1);
  assert.equal(await exists(tempDirCancel), false);

  // Ненулевой код выхода редактора → код 1, без записи, временная папка удалена.
  let tempDirAborted = "";
  const aborted = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      tempDirAborted = dirname(filePath);
      await writeFile(filePath, "changed\n", "utf8");
      return 2;
    },
    reply: () => okResult("files.read", { text: "orig\n", bytes: 5 }),
  });
  assert.equal(
    await runCli(["files", "edit", "x-local://share/a.txt"], aborted.io, aborted.dependencies),
    1,
  );
  assert.match(aborted.state.stderr, /завершился с кодом 2/);
  assert.equal(aborted.state.calls.length, 1);
  assert.equal(await exists(tempDirAborted), false);

  // --yes без вопроса + распаковка meta.truncated + перечитывание перед записью.
  const truncatedYes = harness({
    stdoutIsTTY: false,
    stderrIsTTY: false,
    launchEditor: async (_cmd, filePath) => {
      assert.equal(await readFile(filePath, "utf8"), "полный текст из хранилища\n");
      await writeFile(filePath, "обновлённый текст\n", "utf8");
      return 0;
    },
    results: {
      export: async () => ({ path: "", format: "json", bytes: 0 }),
      loadData: async (id) => {
        assert.equal(id, "11111111-1111-4111-8111-111111111111");
        return { text: "полный текст из хранилища\n", bytes: 48 };
      },
    },
    reply: (id) =>
      id === "files.read"
        ? okResult(
            id,
            { preview: { text: "полный…" } },
            { truncated: true, resultId: "11111111-1111-4111-8111-111111111111" },
          )
        : okResult(id, { bytes: 33, mutationOutcome: "confirmed" }),
  });
  assert.equal(
    await runCli(
      ["files", "edit", "x-local://share/big.txt", "--yes"],
      truncatedYes.io,
      truncatedYes.dependencies,
    ),
    0,
  );
  assert.deepEqual(
    truncatedYes.state.calls.map((c) => c.id),
    ["files.read", "files.read", "files.write"],
  );
  assert.equal(truncatedYes.state.calls[2]?.args.text, "обновлённый текст\n");

  // Не-TTY без --yes и без confirm → отказ ДО чтения файла и запуска редактора.
  const noTty = harness({
    stdoutIsTTY: false,
    stderrIsTTY: false,
    launchEditor: async (_cmd, filePath) => {
      await writeFile(filePath, "new\n", "utf8");
      return 0;
    },
    reply: () => okResult("files.read", { text: "old\n", bytes: 4 }),
  });
  assert.equal(
    await runCli(["files", "edit", "x-local://share/a.txt"], noTty.io, noTty.dependencies),
    1,
  );
  assert.match(noTty.state.stderr, /--yes/);
  assert.equal(noTty.state.editorCalls.length, 0);
  assert.equal(noTty.state.calls.length, 0);

  // Двоичный файл отклоняется до запуска редактора.
  const binary = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async () => 0,
    reply: () => okResult("files.read", { base64: "AAEC", bytes: 3 }),
  });
  assert.equal(
    await runCli(["files", "edit", "x-local://share/a.bin"], binary.io, binary.dependencies),
    1,
  );
  assert.equal(binary.state.editorCalls.length, 0);
  assert.match(binary.state.stderr, /CLI_BINARY_FILE/);

  // --output отклоняется кодом 2.
  const withOutput = harness({ launchEditor: async () => 0 });
  assert.equal(
    await runCli(
      ["files", "edit", "x-local://share/a.txt", "--output", "out.txt"],
      withOutput.io,
      withOutput.dependencies,
    ),
    2,
  );
});

test("object edit (JSON): --fields, preview с serverFilled, expectedFingerprint, отмена и невалидный JSON", async () => {
  let seenTempPath = "";
  const h = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      seenTempPath = filePath;
      assert.equal(basename(filePath), "group_0x10.json");
      const current = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
      assert.deepEqual(current, { name: "Старая", code: "old_code" });
      await writeFile(filePath, JSON.stringify({ name: "Новая" }, null, 2), "utf8");
      return 0;
    },
    reply: (id, args) => {
      if (id === "objects.get") {
        assert.deepEqual(args, { id: "0x10", type: "group", fields: ["name", "code"] });
        return okResult(
          id,
          { preview: {} },
          { truncated: true, resultId: "22222222-2222-4222-8222-222222222222" },
        );
      }
      if (id === "objects.patch" && args.preview === true) {
        assert.equal(args.expectedFingerprint, "fp-1");
        assert.deepEqual(args.patch, { name: "Новая" });
        assert.deepEqual(args.remove, ["code"]);
        return okResult(id, {
          preview: true,
          noop: false,
          fingerprint: "fp-1",
          changes: [
            { op: "set", path: "name", before: "Старая\x1b[31m", after: "Новая" },
            { op: "remove", path: "code", before: "old_code" },
          ],
          serverFilled: ["position_name"],
        });
      }
      if (id === "objects.patch" && args.preview === undefined) {
        assert.equal(args.expectedFingerprint, "fp-1");
        return okResult(id, {
          id: "0x10",
          type: "group",
          url: "x-local://wt_data/objects/0000/16.xml",
          fingerprint: "fp-2",
          changes: [{ op: "set", path: "name", before: "Старая", after: "Новая" }],
          mutationOutcome: "confirmed",
        });
      }
      throw new Error(`Неожиданный вызов ${id}`);
    },
    results: {
      export: async () => ({ path: "", format: "json", bytes: 0 }),
      loadData: async () => ({
        id: "0x10",
        type: "group",
        url: "x-local://wt_data/objects/0000/16.xml",
        fingerprint: "fp-1",
        data: { name: "Старая", code: "old_code" },
      }),
    },
  });

  const code = await runCli(
    ["object", "edit", "group", "0x10", "--fields", "name,code"],
    h.io,
    h.dependencies,
  );
  assert.equal(code, 0, h.state.stderr);
  assert.equal(h.state.calls.length, 3);
  assert.match(h.state.stderr, /Предпросмотр правки/);
  assert.match(h.state.stderr, /position_name/);
  assert.ok(!h.state.stderr.includes("\x1b[31m"));
  assert.ok(h.state.stderr.includes("\\x1b[31m"));
  assert.deepEqual(h.state.confirmQuestions, ["Сохранить изменения объекта? [y/N] "]);
  assert.match(h.state.stdout, /Объект изменён/);
  assert.equal(await exists(dirname(seenTempPath)), false);

  // Отказ на подтверждении не вызывает запись.
  const denied = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: false,
    launchEditor: async (_cmd, filePath) => {
      await writeFile(filePath, '{"name":"Другая"}', "utf8");
      return 0;
    },
    reply: (id, args) =>
      id === "objects.get"
        ? okResult(id, { id: "0x10", type: "group", fingerprint: "fp-1", data: { name: "Старая" } })
        : okResult(id, {
            preview: args.preview === true,
            noop: false,
            fingerprint: "fp-1",
            changes: [{ op: "set", path: "name", before: "Старая", after: "Другая" }],
          }),
  });
  assert.equal(await runCli(["object", "edit", "0x10"], denied.io, denied.dependencies), 1);
  assert.equal(denied.state.calls.length, 2);
  assert.match(denied.state.stderr, /Отменено\./);

  // Невалидный JSON и без изменений.
  let badJsonDir = "";
  const badJson = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      badJsonDir = dirname(filePath);
      await writeFile(filePath, "{сломанный json", "utf8");
      return 0;
    },
    reply: () =>
      okResult("objects.get", {
        id: "0x10",
        type: "group",
        fingerprint: "fp-1",
        data: { name: "А" },
      }),
  });
  assert.equal(await runCli(["object", "edit", "0x10"], badJson.io, badJson.dependencies), 1);
  assert.match(badJson.state.stderr, /INVALID_JSON/);
  assert.equal(badJson.state.calls.length, 1);
  assert.equal(await exists(badJsonDir), false);

  const unchanged = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async () => 0,
    reply: () =>
      okResult("objects.get", {
        id: "0x10",
        type: "group",
        fingerprint: "fp-1",
        data: { name: "А" },
      }),
  });
  assert.equal(await runCli(["object", "edit", "0x10"], unchanged.io, unchanged.dependencies), 0);
  assert.equal(unchanged.state.stdout, "Изменений нет.\n");
  assert.equal(unchanged.state.calls.length, 1);
});

test("object edit --xml редактирует сырой XML через loadDoc/putDoc, сохраняет порядок/комментарии, учитывает default_db_name и отклоняет смену типа/ID", async () => {
  const conflict = harness({ launchEditor: async () => 0, confirm: true });
  assert.equal(
    await runCli(
      ["object", "edit", "group", "0x10", "--xml", "--fields", "name"],
      conflict.io,
      conflict.dependencies,
    ),
    2,
  );

  // Сырой SOAP-ответ с комментарием и чередующимися тегами <part> в нестандартной БД company_data.
  const rawInnerXml =
    "<group>\n  <!-- keep comment -->\n  <id>16</id>\n  <part>A</part>\n  <other>X</other>\n  <part>B</part>\n  <name>Было</name>\n</group>";
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope><soap:Body><LoadDocResponse><Data>\n${rawInnerXml}\n</Data></LoadDocResponse></soap:Body></soap:Envelope>`;
  const binaryLoad = () =>
    okResult("native.lds.loadDoc", {
      kind: "binary",
      bytes: { base64: Buffer.from(soapEnvelope, "utf8").toString("base64") },
    });

  let seenTempPath = "";
  const h = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      seenTempPath = filePath;
      assert.equal(extname(filePath), ".xml");
      const xml = await readFile(filePath, "utf8");
      assert.match(xml, /<!-- keep comment -->/);
      assert.match(xml, /<part>A<\/part>\n  <other>X<\/other>\n  <part>B<\/part>/);
      await writeFile(filePath, xml.replace("<name>Было</name>", "<name>Стало</name>"), "utf8");
      return 0;
    },
    reply: (id, args) => {
      if (id === "objects.get") {
        assert.deepEqual(args, { id: "0x10", type: "group", fields: ["id"] });
        return okResult(id, {
          id: "16",
          type: "group",
          url: "x-local://company_data/objects/0000/16.xml",
          data: { id: "16" },
          fingerprint: "fp",
        });
      }
      if (id === "native.lds.loadDoc") {
        assert.equal(args.url, "x-local://company_data/objects/0000/16.xml");
        assert.equal(args.useBinaryResponse, true);
        return binaryLoad();
      }
      if (id === "native.lds.putDoc") {
        assert.equal(args.url, "x-local://company_data/objects/0000/16.xml");
        assert.equal(args.writeDocInfo, true);
        assert.match(String(args.data), /<!-- keep comment -->/);
        assert.match(String(args.data), /<part>A<\/part>\n  <other>X<\/other>\n  <part>B<\/part>/);
        assert.match(String(args.data), /<name>Стало<\/name>/);
        return okResult(id, {});
      }
      throw new Error(`Неожиданный вызов ${id}`);
    },
  });

  const code = await runCli(["object", "edit", "group", "0x10", "--xml"], h.io, h.dependencies);
  assert.equal(code, 0, h.state.stderr);
  assert.match(h.state.stderr, /-   <name>Было<\/name>/);
  assert.match(h.state.stderr, /\+   <name>Стало<\/name>/);
  assert.deepEqual(h.state.confirmQuestions, ["Сохранить изменения документа? [y/N] "]);
  assert.match(h.state.stdout, /Документ сохранён/);
  assert.equal(await exists(dirname(seenTempPath)), false);

  // Сломанный XML, смена корневого тега (включая SOAP-конверт) и смена ID отклоняются до подтверждения и putDoc.
  for (const [mutated, expectedCode] of [
    ["<group><name>без закрытия</group>", /INVALID_XML/],
    ["<other><id>16</id><name>X</name></other>", /TYPE_MISMATCH/],
    [
      "<soap:Envelope><soap:Body><LoadDocResponse><Data><group><id>16</id><name>X</name></group></Data></LoadDocResponse></soap:Body></soap:Envelope>",
      /TYPE_MISMATCH/,
    ],
    ["<group><id>17</id><name>X</name></group>", /IMMUTABLE_ID/],
    ["<group><name>X</name></group>", /IMMUTABLE_ID/],
  ] as const) {
    const rejected = harness({
      stdoutIsTTY: true,
      stderrIsTTY: true,
      color: false,
      confirm: true,
      launchEditor: async (_cmd, filePath) => {
        await writeFile(filePath, mutated, "utf8");
        return 0;
      },
      reply: (id) =>
        id === "objects.get"
          ? okResult(id, {
              id: "16",
              type: "group",
              url: "x-local://wt_data/objects/0000/16.xml",
              data: { id: "16" },
              fingerprint: "fp",
            })
          : binaryLoad(),
    });
    assert.equal(
      await runCli(
        ["object", "edit", "group", "0x10", "--xml"],
        rejected.io,
        rejected.dependencies,
      ),
      1,
    );
    assert.match(rejected.state.stderr, expectedCode);
    assert.equal(rejected.state.confirmQuestions.length, 0);
    assert.equal(
      rejected.state.calls.some((c) => c.id === "native.lds.putDoc"),
      false,
    );
  }
});

test("completion pwsh|bash|zsh и __complete-connections покрывают реестр без утечки секретов", async () => {
  const pwsh = generateCompletion("pwsh");
  const bash = generateCompletion("bash");
  const zsh = generateCompletion("zsh");

  for (const script of [pwsh, bash, zsh]) {
    assert.ok(script.includes("completion"));
    assert.ok(script.includes("edit"));
    assert.ok(script.includes("rm"));
    assert.ok(script.includes("--editor"));
    assert.ok(script.includes("--xml"));
    assert.ok(script.includes("--format"));
    assert.ok(script.includes("critical"));
    assert.ok(script.includes("native"));
    assert.ok(script.includes("__complete-connections"));
    assert.ok(script.includes("pwsh"));
    assert.ok(script.includes("bash"));
    assert.ok(script.includes("zsh"));
  }
  assert.ok(pwsh.includes("Register-ArgumentCompleter -Native -CommandName wtctl"));
  assert.ok(bash.includes("complete -o default -F _wtctl_completions wtctl"));
  assert.ok(zsh.startsWith("#compdef wtctl\n"));

  // Скрытая команда не попадает в справку CLI.
  const topCommands = Object.keys(cliHelp().commands as Record<string, string>);
  assert.equal(topCommands.includes("__complete-connections"), false);
  assert.equal(topCommands.includes("completion"), true);

  // Ошибки аргументов, --json и --output для completion.
  const bad = harness();
  assert.equal(await runCli(["completion", "fish"], bad.io, bad.dependencies), 2);
  const missing = harness();
  assert.equal(await runCli(["completion"], missing.io, missing.dependencies), 2);
  const passStdin = harness();
  assert.equal(
    await runCli(["completion", "pwsh", "--password-stdin"], passStdin.io, passStdin.dependencies),
    2,
  );
  const csvBad = harness();
  assert.equal(
    await runCli(["completion", "pwsh", "--format", "csv"], csvBad.io, csvBad.dependencies),
    2,
  );

  const jsonOut = harness();
  assert.equal(await runCli(["completion", "bash", "--json"], jsonOut.io, jsonOut.dependencies), 0);
  const parsed = JSON.parse(jsonOut.state.stdout) as OperationResult;
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data, { shell: "bash", script: bash });

  const fileOut = harness();
  assert.equal(
    await runCli(["completion", "zsh", "--output", "wtctl.zsh"], fileOut.io, fileOut.dependencies),
    0,
  );
  assert.equal(fileOut.state.stdout, "");
  assert.equal(fileOut.state.files.get("wtctl.zsh"), zsh);

  // __complete-connections не раскрывает пароли/URL и молча пуст при ошибке файла.
  const dir = await mkdtemp(join(tmpdir(), "wtctl-complete-"));
  try {
    const cfg = join(dir, "connections.json");
    await writeFile(
      cfg,
      JSON.stringify({
        defaultConnection: "prod",
        connections: {
          prod: {
            baseUrl: "https://secret.example/",
            username: "admin",
            password: "top-secret-password",
          },
          stage: { baseUrl: "https://stage.example/", password: "another-secret-value" },
        },
      }),
      "utf8",
    );
    const names = await readConnectionNamesForCompletion(cfg, {
      readFile: (p) => readFile(p, "utf8"),
    });
    assert.deepEqual(names, ["prod", "stage"]);

    const cc = harness({ readFile: (p) => readFile(p, "utf8") });
    assert.equal(
      await runCli(["__complete-connections", "--config", cfg], cc.io, cc.dependencies),
      0,
    );
    assert.equal(cc.state.stdout, "prod\nstage\n");
    assert.ok(!cc.state.stdout.includes("top-secret-password"));
    assert.ok(!cc.state.stdout.includes("secret.example"));

    // Старый формат файла подключений и несуществующий файл.
    const legacy = join(dir, "legacy.json");
    await writeFile(
      legacy,
      JSON.stringify({ defaultConnection: "main", baseUrl: "http://localhost:8088/" }),
      "utf8",
    );
    assert.deepEqual(
      await readConnectionNamesForCompletion(legacy, { readFile: (p) => readFile(p, "utf8") }),
      ["main"],
    );
    const missingCc = harness({ readFile: (p) => readFile(p, "utf8") });
    assert.equal(
      await runCli(
        ["__complete-connections", "--config", join(dir, "absent.json")],
        missingCc.io,
        missingCc.dependencies,
      ),
      0,
    );
    assert.equal(missingCc.state.stdout, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // Синтаксическая проверка PowerShell-парсером при наличии pwsh или powershell.
  const shellBin = ["pwsh", "powershell"].find(
    (bin) => spawnSync(bin, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0,
  );
  if (shellBin) {
    const check = spawnSync(
      shellBin,
      [
        "-NoProfile",
        "-Command",
        "$src = [Console]::In.ReadToEnd(); $t = $null; $e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$t, [ref]$e); if ($e.Count -gt 0) { $e | ForEach-Object { [Console]::Error.WriteLine($_.ToString()) }; exit 1 }",
      ],
      { input: pwsh, encoding: "utf8" },
    );
    assert.equal(check.status, 0, check.stderr);
  }
});

test("files edit и object edit --xml обнаруживают параллельную правку, защищают снимок >512 КиБ и изолируют stdout при --json", async () => {
  // 1. Параллельная правка файла за время редактирования → FILE_CHANGED, без files.write.
  let fileReadCount = 0;
  const fileConflict = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      await writeFile(filePath, "local edit\n", "utf8");
      return 0;
    },
    reply: (id) => {
      if (id === "files.read") {
        fileReadCount++;
        return okResult(id, { text: fileReadCount === 1 ? "v1\n" : "v2-remote\n", bytes: 10 });
      }
      throw new Error(`files.write не должен вызываться, вызван ${id}`);
    },
  });
  assert.equal(
    await runCli(
      ["files", "edit", "x-local://share/a.txt"],
      fileConflict.io,
      fileConflict.dependencies,
    ),
    1,
  );
  assert.match(fileConflict.state.stderr, /FILE_CHANGED/);
  assert.equal(fileReadCount, 2);

  // 2. Параллельная правка XML за время редактирования → CONFLICT, без native.lds.putDoc.
  let xmlLoadCount = 0;
  const xmlConflict = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      await writeFile(filePath, "<group><id>16</id><name>Local</name></group>\n", "utf8");
      return 0;
    },
    reply: (id) => {
      if (id === "objects.get") {
        return okResult(id, {
          id: "16",
          type: "group",
          url: "x-local://wt_data/objects/0000/16.xml",
          data: { id: "16" },
          fingerprint: "fp",
        });
      }
      if (id === "native.lds.loadDoc") {
        xmlLoadCount++;
        const xml =
          xmlLoadCount === 1
            ? "<group><id>16</id><name>V1</name></group>"
            : "<group><id>16</id><name>Remote</name></group>";
        return okResult(id, {
          kind: "binary",
          bytes: { base64: Buffer.from(xml, "utf8").toString("base64") },
        });
      }
      throw new Error(`putDoc не должен вызываться, вызван ${id}`);
    },
  });
  assert.equal(
    await runCli(
      ["object", "edit", "group", "0x10", "--xml"],
      xmlConflict.io,
      xmlConflict.dependencies,
    ),
    1,
  );
  assert.match(xmlConflict.state.stderr, /CONFLICT/);
  assert.equal(xmlLoadCount, 2);

  // 3. Большой файл (> 512 КиБ): подмена tempPath во время confirm не влияет на отправленный снимок.
  const bigEdited = `${"a".repeat(512 * 1024 + 10)}\n`;
  let editedPath = "";
  let writtenContent = "";
  const bigFile = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: async () => {
      await writeFile(editedPath, `${"b".repeat(512 * 1024 + 10)}\n`, "utf8");
      return true;
    },
    launchEditor: async (_cmd, filePath) => {
      editedPath = filePath;
      await writeFile(filePath, bigEdited, "utf8");
      return 0;
    },
    reply: async (id, args) => {
      if (id === "files.read") return okResult(id, { text: "old\n", bytes: 4 });
      if (id === "files.write") {
        assert.equal(typeof args.file, "string");
        assert.notEqual(args.file, editedPath);
        writtenContent = await readFile(String(args.file), "utf8");
        return okResult(id, { bytes: writtenContent.length, mutationOutcome: "confirmed" });
      }
      throw new Error(`unexpected ${id}`);
    },
  });
  assert.equal(
    await runCli(["files", "edit", "x-local://share/big.txt"], bigFile.io, bigFile.dependencies),
    0,
  );
  assert.equal(writtenContent, bigEdited);

  // 4. При --yes --json редактору передаётся redirectStdoutToStderr: true.
  let seenRedirect: boolean | undefined;
  const jsonEdit = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    launchEditor: async (_cmd, _filePath, opts) => {
      seenRedirect = opts?.redirectStdoutToStderr;
      return 0;
    },
    reply: () => okResult("files.read", { text: "same\n", bytes: 5 }),
  });
  assert.equal(
    await runCli(
      ["files", "edit", "x-local://share/a.txt", "--yes", "--json"],
      jsonEdit.io,
      jsonEdit.dependencies,
    ),
    0,
  );
  assert.equal(seenRedirect, true);

  // 5. UTF-8 BOM сохраняется при правке и его параллельное добавление на сервере вызывает FILE_CHANGED.
  const bomInitial = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("var x = 1;\n", "utf8"),
  ]);
  let bomWrittenText = "";
  const bomKeep = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      const bytes = await readFile(filePath);
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      await writeFile(
        filePath,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("var x = 2;\n", "utf8")]),
      );
      return 0;
    },
    reply: async (id, args) => {
      if (id === "files.read") {
        assert.equal(typeof args.file, "string");
        assert.equal(args.overwrite, true);
        await writeFile(String(args.file), bomInitial);
        return okResult(id, { file: String(args.file), bytes: bomInitial.length });
      }
      if (id === "files.write") {
        bomWrittenText = String(args.text);
        return okResult(id, {
          bytes: Buffer.byteLength(bomWrittenText, "utf8"),
          mutationOutcome: "confirmed",
        });
      }
      throw new Error(`unexpected ${id}`);
    },
  });
  assert.equal(
    await runCli(["files", "edit", "x-local://share/bom.js"], bomKeep.io, bomKeep.dependencies),
    0,
  );
  assert.equal(bomWrittenText, "\uFEFFvar x = 2;\n");

  let bomReads = 0;
  const bomRace = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      await writeFile(filePath, "var x = 2;\n", "utf8");
      return 0;
    },
    reply: (id) => {
      if (id === "files.read") {
        bomReads++;
        const buf =
          bomReads === 1
            ? Buffer.from("var x = 1;\n", "utf8")
            : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("var x = 1;\n", "utf8")]);
        return okResult(id, { base64: buf.toString("base64"), bytes: buf.length });
      }
      throw new Error(`files.write не должен вызываться при добавлении BOM: ${id}`);
    },
  });
  assert.equal(
    await runCli(["files", "edit", "x-local://share/bom2.js"], bomRace.io, bomRace.dependencies),
    1,
  );
  assert.match(bomRace.state.stderr, /FILE_CHANGED/);
});

test("renderLineDiff ограничивает огромную одиночную строку, а __complete-connections отклоняет лишние аргументы и флаги", async () => {
  const plain = createStyler(false);
  const oneMbBefore = `${"A".repeat(1024 * 1024)}\n`;
  const oneMbAfter = `${"B".repeat(1024 * 1024)}\n`;
  const diff = renderLineDiff(oneMbBefore, oneMbAfter, plain);
  assert.ok(diff.length < 4096, `diff слишком длинный: ${diff.length}`);
  assert.match(diff, /ещё \d+ знаков/);

  for (const badArgv of [
    ["__complete-connections", "dummy"],
    ["__complete-connections", "--output", "out.txt"],
    ["__complete-connections", "--json"],
    ["__complete-connections", "--password-stdin"],
  ]) {
    const h = harness();
    assert.equal(await runCli(badArgv, h.io, h.dependencies), 2, badArgv.join(" "));
  }
});

test("completion корректно разворачивает --config в кавычках и '=' в bash и pwsh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl comp space "));
  try {
    const cfg = join(dir, "cfg.json");
    await writeFile(
      cfg,
      JSON.stringify({
        defaultConnection: "foo-conn",
        connections: {
          "foo-conn": { baseUrl: "http://foo.invalid/" },
          "bar-conn": { baseUrl: "http://bar.invalid/" },
        },
      }),
      "utf8",
    );
    const bashScript = generateCompletion("bash");
    const hasBash = spawnSync("bash", ["-c", "exit 0"], { stdio: "ignore" }).status === 0;
    if (hasBash) {
      const cfgPosix = cfg.replaceAll("\\", "/");
      const bashProbe = `${bashScript}
_wtctl_complete_connections() {
  local cfg="$1"
  if [[ "$cfg" == "${cfgPosix}" ]]; then
    printf 'foo-conn\\nbar-conn\\n'
  fi
}
COMP_WORDS=(wtctl --config '"${cfgPosix}"' --connection f)
COMP_CWORD=4
_wtctl_completions
printf 'QUOTED=%s\\n' "\${COMPREPLY[*]}"

COMP_WORDS=(wtctl --config = '"${cfgPosix}"' --connection f)
COMP_CWORD=5
_wtctl_completions
printf 'EQCFG=%s\\n' "\${COMPREPLY[*]}"

COMP_WORDS=(wtctl --format = j)
COMP_CWORD=3
_wtctl_completions
printf 'EQFMT=%s\\n' "\${COMPREPLY[*]}"
`;
      const res = spawnSync("bash", ["-s"], { input: bashProbe, encoding: "utf8" });
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /QUOTED=foo-conn/);
      assert.match(res.stdout, /EQCFG=foo-conn/);
      assert.match(res.stdout, /EQFMT=json jsonl|EQFMT=jsonl json/);
    }

    const shellBin = ["pwsh", "powershell"].find(
      (bin) =>
        spawnSync(bin, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0,
    );
    if (shellBin && (await exists(join(process.cwd(), "dist", "cli", "bin.js")))) {
      const pwshScript = generateCompletion("pwsh");
      const cfgAposDir = await mkdtemp(join(tmpdir(), "wtctl it's "));
      try {
        const cfgApos = join(cfgAposDir, "cfg.json");
        await writeFile(
          cfgApos,
          JSON.stringify({
            defaultConnection: "apos-conn",
            connections: { "apos-conn": { baseUrl: "http://apos.invalid/" } },
          }),
          "utf8",
        );
        const pwshProbe = [
          pwshScript.replace(
            "& wtctl @callArgs 2>$null",
            `& ${JSON.stringify(process.execPath)} ${JSON.stringify(join(process.cwd(), "dist", "cli", "bin.js"))} @callArgs 2>$null`,
          ),
          `$q1 = "wtctl --config='${cfg.replaceAll("'", "''")}' -c f"`,
          `$r1 = (TabExpansion2 -inputScript $q1 -cursorColumn $q1.Length).CompletionMatches.CompletionText -join ','`,
          `Write-Output "PWEQ=$r1"`,
          `$q2 = "wtctl --config '${cfgApos.replaceAll("'", "''")}' -c a"`,
          `$r2 = (TabExpansion2 -inputScript $q2 -cursorColumn $q2.Length).CompletionMatches.CompletionText -join ','`,
          `Write-Output "PWAPOS=$r2"`,
        ].join("\n");
        const pwRes = spawnSync(shellBin, ["-NoProfile", "-Command", "-"], {
          input: pwshProbe,
          encoding: "utf8",
        });
        assert.equal(pwRes.status, 0, pwRes.stderr);
        assert.match(pwRes.stdout, /PWEQ=foo-conn/);
        assert.match(pwRes.stdout, /PWAPOS=apos-conn/);
      } finally {
        await rm(cfgAposDir, { recursive: true, force: true });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("diffObjectFields и XmlDocument.patch не перезаписывают переименованные/числовые ключи и сохраняют атрибуты и комментарии", () => {
  // 1. Переименование a -> c при добавлении элемента с name=c не должно затереть элемент 0.
  const renameXml =
    '<group><id>1</id><items><item attr="a"><!-- c1 --><name>a</name><val>1</val></item><item attr="b"><name>b</name><val>2</val></item></items></group>';
  const renameDoc = XmlDocument.parse(renameXml);
  const renameDiff = diffObjectFields(renameDoc.snapshot().data, {
    id: "1",
    items: {
      item: [
        { name: "c", val: "1" },
        { name: "b", val: "2" },
        { name: "c", val: "3" },
      ],
    },
  });
  const renamePatched = renameDoc.patch(renameDiff.patch);
  assert.deepEqual(JSON.parse(JSON.stringify(renamePatched.after.data.items)), {
    item: [
      { name: "c", val: "1" },
      { name: "b", val: "2" },
      { name: "c", val: "3" },
    ],
  });
  assert.match(renamePatched.after.xml, /attr="a"/);
  assert.match(renamePatched.after.xml, /<!-- c1 -->/);
  assert.throws(
    () =>
      diffObjectFields(
        { items: { item: [{ name: "a" }, { name: "b" }] } },
        { items: { item: [{ name: "c" }, { name: "b" }, { name: "c" }] } },
      ),
    (err: unknown) => err instanceof HcmError && err.code === "UNSUPPORTED_LIST_APPEND",
  );

  // 2. Коллизия целочисленных ключей 0x10 и 16 при расширении списка из одного элемента.
  const singleXml =
    '<group><id>1</id><note attr="n"><!-- keep-scalar -->старо</note><items><item attr="one"><!-- keep-one --><id>0x10</id><val>1</val></item></items></group>';
  const singleDoc = XmlDocument.parse(singleXml);
  const singleDiff = diffObjectFields(singleDoc.snapshot().data, {
    id: "1",
    note: "ново",
    items: {
      item: [
        { id: "0x10", val: "1" },
        { id: "16", val: "2" },
      ],
    },
  });
  const singlePatched = singleDoc.patch(singleDiff.patch);
  assert.equal(singlePatched.after.data.note, "ново");
  assert.match(singlePatched.after.xml, /<note attr="n"><!-- keep-scalar -->ново<\/note>/);
  assert.match(singlePatched.after.xml, /<item attr="one"><!-- keep-one --><id>0x10<\/id>/);
  assert.deepEqual(JSON.parse(JSON.stringify(singlePatched.after.data.items)), {
    item: [
      { id: "0x10", val: "1" },
      { id: "16", val: "2" },
    ],
  });
  assert.throws(
    () =>
      diffObjectFields(
        { items: { item: { id: "0x10" } } },
        { items: { item: [{ id: "0x10" }, { id: "16" }] } },
      ),
    (err: unknown) => err instanceof HcmError && err.code === "UNSUPPORTED_LIST_APPEND",
  );

  // 3. Ключ в формате даты со сброшенным +00:00 (objects.get убирает +00:00, а XML хранит его).
  const dateXml =
    '<group><id>1</id><items><item attr="d"><when>2026-01-02T03:04:05+00:00</when><val>1</val></item></items></group>';
  const dateDoc = XmlDocument.parse(dateXml);
  const dateDiff = diffObjectFields(
    { id: "1", items: { item: { when: "2026-01-02T03:04:05", val: "1" } } },
    {
      id: "1",
      items: {
        item: [
          { when: "2026-01-02T03:04:05", val: "1" },
          { when: "2026-01-02T03:04:05+00:00", val: "2" },
        ],
      },
    },
  );
  const datePatched = dateDoc.patch(dateDiff.patch);
  assert.deepEqual(JSON.parse(JSON.stringify(datePatched.after.data.items)), {
    item: [
      { when: "2026-01-02T03:04:05+00:00", val: "1" },
      { when: "2026-01-02T03:04:05+00:00", val: "2" },
    ],
  });
  assert.match(datePatched.after.xml, /attr="d"/);
  assert.throws(
    () =>
      diffObjectFields(
        { items: { item: { when: "2026-01-02T03:04:05" } } },
        {
          items: {
            item: [{ when: "2026-01-02T03:04:05" }, { when: "2026-01-02T03:04:05+00:00" }],
          },
        },
      ),
    (err: unknown) => err instanceof HcmError && err.code === "UNSUPPORTED_LIST_APPEND",
  );
});

test("object edit --xml принимает документ с namespace в корне и отклоняет смену локального типа", async () => {
  for (const nsXml of [
    '<ns:group xmlns:ns="urn:test"><id>16</id><name>Было</name></ns:group>',
    '<пр:group xmlns:пр="urn:test"><id>16</id><name>Было</name></пр:group>',
  ]) {
    const soap = `<soap:Envelope><soap:Body><LoadDocResponse><Data>${nsXml}</Data></LoadDocResponse></soap:Body></soap:Envelope>`;
    const loadRes = () =>
      okResult("native.lds.loadDoc", {
        kind: "binary",
        bytes: { base64: Buffer.from(soap, "utf8").toString("base64") },
      });

    let writtenXml = "";
    const ok = harness({
      stdoutIsTTY: true,
      stderrIsTTY: true,
      color: false,
      confirm: true,
      launchEditor: async (_cmd, filePath) => {
        const text = await readFile(filePath, "utf8");
        await writeFile(filePath, text.replace("<name>Было</name>", "<name>Стало</name>"), "utf8");
        return 0;
      },
      reply: (id, args) => {
        if (id === "objects.get") {
          return okResult(id, {
            id: "16",
            type: "group",
            url: "x-local://wt_data/objects/0000/16.xml",
            data: { id: "16" },
            fingerprint: "fp",
          });
        }
        if (id === "native.lds.loadDoc") return loadRes();
        if (id === "native.lds.putDoc") {
          writtenXml = String(args.data);
          return okResult(id, {});
        }
        throw new Error(`Неожиданный вызов ${id}`);
      },
    });

    assert.equal(
      await runCli(["object", "edit", "group", "0x10", "--xml"], ok.io, ok.dependencies),
      0,
    );
    assert.ok(writtenXml.includes(nsXml.replace("<name>Было</name>", "<name>Стало</name>")));
  }

  const soap =
    '<soap:Envelope><soap:Body><LoadDocResponse><Data><пр:group xmlns:пр="urn:test"><id>16</id><name>Было</name></пр:group></Data></LoadDocResponse></soap:Body></soap:Envelope>';
  const loadRes = () =>
    okResult("native.lds.loadDoc", {
      kind: "binary",
      bytes: { base64: Buffer.from(soap, "utf8").toString("base64") },
    });
  const wrongType = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    confirm: true,
    launchEditor: async (_cmd, filePath) => {
      await writeFile(
        filePath,
        '<пр:person xmlns:пр="urn:test"><id>16</id><name>Стало</name></пр:person>',
        "utf8",
      );
      return 0;
    },
    reply: (id) =>
      id === "objects.get"
        ? okResult(id, {
            id: "16",
            type: "group",
            url: "x-local://wt_data/objects/0000/16.xml",
            data: { id: "16" },
            fingerprint: "fp",
          })
        : loadRes(),
  });
  assert.equal(
    await runCli(
      ["object", "edit", "group", "0x10", "--xml"],
      wrongType.io,
      wrongType.dependencies,
    ),
    1,
  );
  assert.match(wrongType.state.stderr, /TYPE_MISMATCH/);
});
