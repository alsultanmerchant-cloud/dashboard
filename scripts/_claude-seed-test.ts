// shim server-only so bun can import the workflow outside a server context
import { Module } from "module";
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: any[]) {
  if (request === "server-only") return require.resolve("./_server-only-shim.cjs");
  return origResolve.call(this, request, ...rest);
};
