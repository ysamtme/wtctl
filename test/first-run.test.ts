// Первые пятнадцать минут нового пользователя: ничего не настроено, адрес неверен, сервер
// не работает, пароль неверен. В каждом случае нужно сказать, что случилось и что делать.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli/run.js";
import { DeferredRuntime } from "../src/cli/deferred-runtime.js";
import type { CliDependencies, CliIo, RuntimePort } from "../src/cli/types.js";
import { defaultConfigPath, loadConfig } from "../src/config.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { HcmError } from "../src/errors.js";
import { HcmRuntime } from "../src/runtime.js";
import { VERSION } from "../src/version.js";

const SETTINGS = [
  "WTCTL_HOME",
  "WTCTL_CONFIG",
  "WTCTL_CONNECTION",
  "WTCTL_URL",
  "WTCTL_USERNAME",
  "WTCTL_PASSWORD",
  "WTCTL_RUNTIME_DIR",
  "WTCTL_ALLOW_WRITE",
  "WTCTL_ALLOW_EXECUTE",
  "PROD_PASSWORD",
];
/** Запуск с чистым набором переменных подключения и пустой папкой клиента; после — вернуть оба. */
async function cleanSettings<T>(
  run: (home: string) => Promise<T>,
  variables: Record<string, string> = {},
): Promise<T> {
  const previous = SETTINGS.map((key) => process.env[key]);
  const home = await mkdtemp(join(tmpdir(), "hcm-first-run-"));
  try {
    for (const key of SETTINGS) delete process.env[key];
    process.env.WTCTL_HOME = home;
    Object.assign(process.env, variables);
    return await run(home);
  } finally {
    SETTINGS.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    await rm(home, { recursive: true, force: true });
  }
}

const base = {
  name: "t",
  baseUrl: "http://hcm.example.org:8088/",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
  outputLimitBytes: 4096,
  runtimeDir: ".unused",
  permissions: { write: true, execute: true },
} as const;
/** Сбой сети в том виде, как его сообщает fetch в Node: TypeError, чья cause несёт системный код. */
function failingFetch(code: string): NonNullable<ConnectionConfig["fetch"]> {
  return async () => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
  };
}

test("без настроек ответ говорит, что задать", async () => {
  await cleanSettings(async () => {
    assert.throws(
      () => loadConfig(),
      (error: HcmError) =>
        error.code === "NOT_CONFIGURED" &&
        /WTCTL_URL/.test(error.hint!) &&
        /wtctl config init/.test(error.hint!),
    );
  });
});

test("файл подключений в папке клиента находится без указания имени", async () => {
  await cleanSettings(async (home) => {
    assert.equal(defaultConfigPath(), join(home, "connections.json"));
    await writeFile(
      defaultConfigPath(),
      JSON.stringify({
        defaultConnection: "main",
        connections: {
          main: { baseUrl: "http://from-file.example/", username: "u", password: "p" },
        },
      }),
    );
    const config = loadConfig();
    assert.equal(config.baseUrl, "http://from-file.example/");
    assert.equal(config.name, "main");
    assert.equal(config.runtimeDir, join(home, "runtime"));
    assert.deepEqual(config.permissions, { write: false, execute: false });
    // Переменные описывают собственное подключение и не смешиваются с файлом.
    process.env.WTCTL_URL = "http://from-env.example/";
    assert.equal(loadConfig().baseUrl, "http://from-env.example/");
    assert.equal(loadConfig().username, undefined);
  });
});

test("ошибки настройки называют файл, строку и известные подключения", async () => {
  await cleanSettings(async (home) => {
    const file = join(home, "bad.json");
    await writeFile(file, '{\n "connections": {\n  "a": {,\n');
    assert.throws(
      () => loadConfig({ configPath: file }),
      (error: HcmError) => error.code === "INVALID_CONFIG" && /строке 3/.test(error.message),
    );
    assert.throws(
      () => loadConfig({ configPath: join(home, "none.json") }),
      (error: HcmError) => error.code === "INVALID_CONFIG" && /не найден/.test(error.message),
    );
    await writeFile(file, JSON.stringify({ connections: { one: {}, two: {} } }));
    assert.throws(
      () => loadConfig({ configPath: file, connection: "three" }),
      (error: HcmError) => error.code === "UNKNOWN_CONNECTION" && /one, two/.test(error.hint!),
    );
    assert.throws(
      () => loadConfig({ configPath: file, connection: "one" }),
      (error: HcmError) => error.code === "INVALID_CONFIG" && /baseUrl/.test(error.message),
    );
  });
});

test("отказ выбора подключения называет, откуда взято имя", async () => {
  await cleanSettings(async (home) => {
    const file = join(home, "connections.json");
    const write = (document: object) => writeFile(file, JSON.stringify(document));
    const refusal = (options = {}) => {
      try {
        loadConfig({ configPath: file, ...options });
      } catch (error) {
        return error as HcmError;
      }
      assert.fail("подключение выбрано");
    };
    await write({ defaultConnection: "gone", connections: { bad: {} } });
    assert.match(
      refusal({ connection: "three" }).message,
      /нет подключения three\. .*--connection/,
    );
    assert.match(refusal().message, /нет подключения gone\. .*из defaultConnection/);
    process.env.WTCTL_CONNECTION = "stage";
    const env = refusal();
    assert.equal(env.code, "UNKNOWN_CONNECTION");
    assert.match(env.message, /нет подключения stage\. .*из переменной WTCTL_CONNECTION/);
    assert.match(env.hint!, /^Есть: bad\./);
    process.env.WTCTL_CONNECTION = "a b";
    assert.match(refusal().hint!, /WTCTL_CONNECTION/);
    delete process.env.WTCTL_CONNECTION;
    await write({ connections: { bad: {} } });
    assert.match(refusal().message, /нет подключения default\. Имя по умолчанию/);
  });
});

test("отказ прав называет подключение и где ему включить право", async () => {
  await cleanSettings(async (home) => {
    const file = join(home, "connections.json");
    await writeFile(
      file,
      JSON.stringify({ connections: { prod: { baseUrl: "http://hcm.example.org/" } } }),
    );
    const refusal = async (config: ConnectionConfig, id: string, args: Record<string, unknown>) => {
      const runtime = new HcmRuntime(config);
      try {
        return (await runtime.call(id, args)).error!;
      } finally {
        await runtime.close();
      }
    };
    const execute = await refusal(
      loadConfig({ configPath: file, connection: "prod" }),
      "execute.script",
      { code: "RESULT = 1;" },
    );
    assert.equal(execute.code, "EXECUTE_DISABLED");
    assert.match(execute.hint!, /permissions\.execute: true у подключения prod .*--config/);
    // Перезапуск касается только MCP-сервера.
    assert.doesNotMatch(execute.hint!, /MCP-сервер/);
    // Копия подключения в SDK получает ту же подсказку, что и само подключение.
    const copy = await refusal(
      { ...loadConfig({ configPath: file, connection: "prod" }), timeoutMs: 5000 },
      "execute.script",
      { code: "RESULT = 1;" },
    );
    assert.equal(copy.hint, execute.hint);
    const found = await refusal(loadConfig({ connection: "prod" }), "execute.script", {
      code: "RESULT = 1;",
    });
    assert.match(found.hint!, /у подключения prod .*wtctl config path/);
    process.env.WTCTL_URL = "http://hcm.example.org/";
    const write = await refusal(loadConfig(), "objects.delete", { id: "0x1" });
    assert.equal(write.code, "WRITE_DISABLED");
    assert.match(write.hint!, /WTCTL_ALLOW_WRITE=true/);
    const settings = await refusal(
      loadConfig({ settings: { baseUrl: "http://hcm.example.org/" } }),
      "execute.script",
      { code: "RESULT = 1;" },
    );
    assert.match(settings.hint!, /settings\.permissions\.execute: true/);
  });
});

test("сервер, до которого не достучаться, назван с причиной", async () => {
  const cases: [code: string, message: RegExp, hint: RegExp][] = [
    [
      "ECONNREFUSED",
      /http:\/\/hcm\.example\.org:8088 не отвечает: соединение отклонено/,
      /запущен/,
    ],
    ["ENOTFOUND", /Адрес сервера не найден: hcm\.example\.org/, /WTCTL_URL/],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", /Сертификат сервера/, /NODE_EXTRA_CA_CERTS/],
    ["ERR_SSL_WRONG_VERSION_NUMBER", /защищённое соединение/, /https/],
    ["ECONNRESET", /оборвалось/, /повторить/],
  ];
  for (const [code, message, hint] of cases) {
    const runtime = new HcmRuntime({
      ...base,
      username: "u",
      password: "p",
      fetch: failingFetch(code),
    });
    const read = await runtime.call("runtime.status", {});
    assert.equal(read.error?.code, "PLATFORM_HTTP", code);
    assert.match(read.error!.message, message);
    assert.match(read.error!.hint!, hint);
    const write = await runtime.call("execute.script", { code: "RESULT = [];" });
    // Сессия не была открыта, поэтому код до сервера не дошёл.
    assert.equal(write.error?.mutationOutcome, "not_sent");
    await runtime.close();
  }
});

test("отсутствующий или отклонённый вход говорит, который из двух", async () => {
  const anonymous = new HcmRuntime({ ...base, fetch: async () => new Response("") });
  const missing = await anonymous.call("runtime.status", {});
  assert.equal(missing.error?.code, "PLATFORM_AUTH");
  assert.match(missing.error!.message, /Не заданы имя пользователя и пароль/);
  assert.match(missing.error!.hint!, /WTCTL_USERNAME/);
  await anonymous.close();
  const refusedLogin = new HcmRuntime({
    ...base,
    username: "u",
    password: "p",
    fetch: async () => new Response("", { status: 401 }),
  });
  const refused = await refusedLogin.call("runtime.status", {});
  assert.equal(refused.error?.code, "PLATFORM_AUTH");
  assert.match(refused.error!.message, /отказал во входе \(HTTP 401\)/);
  assert.equal(refused.error!.details?.status, 401);
  await refusedLogin.close();
});

test("самопроверка кладёт причину неудачного входа в свою ошибку", async () => {
  const runtime = new HcmRuntime({
    ...base,
    username: "u",
    password: "p",
    fetch: failingFetch("ECONNREFUSED"),
  });
  const result = await runtime.call("runtime.check", {});
  assert.equal(result.error?.code, "CHECK_FAILED");
  assert.match(result.error!.message, /не пройдена: login/);
  assert.match(result.error!.hint!, /не отвечает: соединение отклонено.*запущен/);
  const checks = (result.data as { checks: { name: string; result: string; reason?: string }[] })
    .checks;
  assert.equal(checks[0]!.result, "failed");
  assert.equal(checks.filter((check) => check.result === "skipped").length, checks.length - 1);
  await runtime.close();
});

function cli(options: { stdin?: string; answers?: string[] } = {}) {
  const state = { stdout: "", stderr: "", questions: [] as [string, boolean][] };
  const answers = [...(options.answers ?? [])];
  const io: CliIo = {
    writeOut: (text) => void (state.stdout += text),
    writeError: (text) => void (state.stderr += text),
    readFile: (path) => readFile(path, "utf8"),
    readStdin: async () => options.stdin ?? "",
    writeFile: async (path, text) => {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, text);
    },
    ...(options.answers
      ? {
          prompt: async (question: string, secret = false) => {
            state.questions.push([question, secret]);
            return answers.shift() ?? "";
          },
        }
      : {}),
  };
  const dependencies: CliDependencies = {
    loadConfiguration: loadConfig,
    createRuntime: () => {
      throw new Error("no runtime in this test");
    },
    runMcp: async () => {},
  };
  const json = (): OperationResult => JSON.parse(state.stdout || state.stderr) as OperationResult;
  return { state, io, dependencies, json };
}

test("version — это команда и флаг", async () => {
  for (const argv of [["version"], ["--version"], ["-v"]]) {
    const f = cli();
    assert.equal(await runCli(argv, f.io, f.dependencies), 0);
    assert.deepEqual((f.json().data as { version: string }).version, VERSION);
  }
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  assert.equal(VERSION, packageJson.version);
});

test("config init пишет подключение только для чтения и сохраняет уже существующие", async () => {
  await cleanSettings(async (home) => {
    const first = cli({ stdin: "s3cret\n" });
    assert.equal(
      await runCli(
        [
          "config",
          "init",
          "--url",
          "http://localhost:8088",
          "--username",
          "admin",
          "--password-stdin",
        ],
        first.io,
        first.dependencies,
      ),
      0,
    );
    assert.doesNotMatch(first.state.stdout, /s3cret/);
    assert.equal((first.json().data as { path: string }).path, join(home, "connections.json"));
    const config = loadConfig();
    assert.equal(config.name, "default");
    assert.equal(config.baseUrl, "http://localhost:8088/");
    assert.equal(config.password, "s3cret");
    assert.deepEqual(config.permissions, { write: false, execute: false });

    const second = cli();
    const argv = [
      "config",
      "init",
      "--name",
      "prod",
      "--url",
      "https://hcm.example.org",
      "--username",
      "admin",
      "--password-env",
      "PROD_PASSWORD",
      "--allow-write",
    ];
    assert.equal(await runCli(argv, second.io, second.dependencies), 0);
    assert.match(
      (second.json().data as { next: string }).next,
      /^Переменная PROD_PASSWORD сейчас не задана.*--connection prod check$/,
    );
    assert.throws(
      () => loadConfig({ connection: "prod" }),
      (error: HcmError) =>
        error.code === "INVALID_CONFIG" && /PROD_PASSWORD из passwordEnv/.test(error.message),
    );
    process.env.PROD_PASSWORD = "s3cret";
    assert.equal(loadConfig({ connection: "prod" }).password, "s3cret");
    const document = JSON.parse(await readFile(defaultConfigPath(), "utf8")) as {
      defaultConnection: string;
      connections: Record<string, Record<string, unknown>>;
    };
    assert.equal(document.defaultConnection, "default");
    assert.deepEqual(Object.keys(document.connections), ["default", "prod"]);
    assert.equal(document.connections.prod!.passwordEnv, "PROD_PASSWORD");
    assert.deepEqual(document.connections.prod!.permissions, { write: true, execute: false });

    const again = cli();
    assert.equal(await runCli(argv, again.io, again.dependencies), 1);
    assert.equal(again.json().error?.code, "CONNECTION_EXISTS");
    const forced = cli();
    assert.equal(await runCli([...argv, "--force"], forced.io, forced.dependencies), 0);
  });
});

test("config init спрашивает в терминале и отказывается угадывать без него", async () => {
  await cleanSettings(async () => {
    const asked = cli({ answers: ["http://localhost:8088", "admin", "typed"] });
    assert.equal(await runCli(["config", "init"], asked.io, asked.dependencies), 0);
    assert.deepEqual(
      asked.state.questions.map(([, secret]) => secret),
      [false, false, true],
    );
    assert.equal(loadConfig().password, "typed");
    const silent = cli();
    assert.equal(
      await runCli(["config", "init", "--name", "other"], silent.io, silent.dependencies),
      2,
    );
    assert.match(silent.json().error!.hint!, /--password-stdin/);
  });
});

test("MCP-сервер без настроек запускается и отвечает, что задать, а после их появления работает", async () => {
  await cleanSettings(async () => {
    const calls: string[] = [];
    const real: RuntimePort = {
      listOperations: () => ({ operations: [], total: 0 }),
      describe: () => {
        throw new Error("unused");
      },
      getOperationEffect: () => "read",
      call: async (id) => {
        calls.push(id);
        return { ok: true, data: 1, meta: { operationId: id, connection: "c", durationMs: 0 } };
      },
      close: async () => {},
    };
    let served: RuntimePort | undefined;
    const f = cli();
    const dependencies: CliDependencies = {
      loadConfiguration: loadConfig,
      createRuntime: () => real,
      local: { node: "node-here", script: "command-here" },
      runMcp: async (runtime, name) => {
        served = runtime;
        assert.equal(name, "unconfigured");
        const refused = await runtime.call("runtime.status");
        assert.equal(refused.error?.code, "NOT_CONFIGURED");
        assert.match(refused.error!.hint!, /"node-here" "command-here" config init$/);
        assert.ok(runtime.listOperations({ limit: 1 }).operations.length > 0);
        process.env.WTCTL_URL = "http://localhost:8088";
        assert.equal((await runtime.call("runtime.status")).ok, true);
      },
    };
    assert.equal(await runCli(["mcp"], f.io, dependencies), 0);
    assert.ok(served instanceof DeferredRuntime);
    assert.deepEqual(calls, ["runtime.status"]);
  });
});

test("сервер, запущенный через npx, называет команду npx, а не путь внутри её кэша", async () => {
  await cleanSettings(async () => {
    const f = cli();
    const dependencies: CliDependencies = {
      loadConfiguration: loadConfig,
      createRuntime: () => {
        throw new Error("unused");
      },
      local: { node: "node-here", script: "/home/u/.npm/_npx/1a2b/node_modules/wtctl/bin.js" },
      runMcp: async (runtime) => {
        const refused = await runtime.call("runtime.status");
        assert.match(refused.error!.hint!, /полная команда: npx -y wtctl config init$/);
      },
    };
    assert.equal(await runCli(["mcp"], f.io, dependencies), 0);
  });
});
