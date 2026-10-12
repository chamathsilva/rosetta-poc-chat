import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

if (typeof globalThis.ReadableStream === "undefined") {
  const { ReadableStream } = await import("node:stream/web");
  globalThis.ReadableStream = ReadableStream as typeof globalThis.ReadableStream;
}

if (typeof globalThis.TextDecoder === "undefined" || typeof globalThis.TextEncoder === "undefined") {
  const { TextDecoder, TextEncoder } = await import("node:util");
  if (typeof globalThis.TextDecoder === "undefined") {
    globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
  }
  if (typeof globalThis.TextEncoder === "undefined") {
    globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
  }
}
