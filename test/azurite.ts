import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

/** Local emulator only; deliberately different from Support Desk's test port. */
export const TABLE_PORT = 10212;

let child: ChildProcess | undefined;
let workspace: string | undefined;

function accepting(port: number): Promise<boolean> {
  return new Promise((resolveAccepting) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const finish = (ready: boolean) => {
      socket.destroy();
      resolveAccepting(ready);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1_000, () => finish(false));
  });
}

async function removeWorkspace(): Promise<void> {
  if (workspace === undefined) return;
  const absolute = resolve(workspace);
  const parent = resolve(tmpdir()) + sep;
  if (
    !absolute.startsWith(parent) ||
    !basename(absolute).startsWith("pegma-knowledge-azurite-")
  ) {
    throw new Error("Refusing to remove an unexpected Azurite test workspace");
  }
  await rm(absolute, { recursive: true, force: true });
  workspace = undefined;
}

export async function setup(): Promise<void> {
  const entry = join(
    process.cwd(),
    "node_modules",
    "azurite",
    "dist",
    "src",
    "table",
    "main.js",
  );
  if (!existsSync(entry))
    throw new Error(
      "Azurite table service is missing; install repository dependencies first.",
    );
  if (await accepting(TABLE_PORT))
    throw new Error(`Azurite test port ${TABLE_PORT} is already in use.`);
  workspace = await mkdtemp(join(tmpdir(), "pegma-knowledge-azurite-"));
  child = spawn(
    process.execPath,
    [
      entry,
      "--location",
      workspace,
      "--silent",
      "--tableHost",
      "127.0.0.1",
      "--tablePort",
      String(TABLE_PORT),
      "--disableTelemetry",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  let failure: Error | undefined;
  child.once("error", (error) => {
    failure = error;
  });
  const deadline = Date.now() + 30_000;
  try {
    while (Date.now() < deadline) {
      if (failure !== undefined) throw failure;
      if (child.exitCode !== null)
        throw new Error(`Azurite exited early: ${child.exitCode}`);
      if (await accepting(TABLE_PORT)) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    throw new Error(`Azurite did not start on test port ${TABLE_PORT}.`);
  } catch (error) {
    child.kill();
    child = undefined;
    await removeWorkspace();
    throw error;
  }
}

export async function teardown(): Promise<void> {
  child?.kill();
  child = undefined;
  await removeWorkspace();
}
