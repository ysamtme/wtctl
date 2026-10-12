// Loaded before every test file: tests must not read the developer's own client folder.
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.WTCTL_HOME = join(tmpdir(), "wtctl-tests-home");
