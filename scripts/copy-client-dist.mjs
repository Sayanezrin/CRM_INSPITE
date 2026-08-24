import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const rootDist = resolve("dist");
const clientDist = resolve("client", "dist");

await rm(rootDist, { recursive: true, force: true });
await cp(clientDist, rootDist, { recursive: true });
