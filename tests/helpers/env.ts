// Side-effect-only module: sets DEMO_STUDIO_DATA_DIR to a fresh temp directory
// BEFORE any module that calls writableDataDir() at import time (jobs.ts) or
// call time (paths.ts, sdk-store.ts) is imported. Import this file first,
// as a bare `import "./helpers/env.ts";` statement, in any test file that
// (transitively) imports jobs.ts or sdk-store.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DEMO_STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "demo-studio-test-"));
