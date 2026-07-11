import { File as NodeFile } from "node:buffer";
import { NextRequest } from "next/server";
import { runExtract, type UploadedFile } from "@/lib/run-extract";

// Node only made `File` a global starting in v20; importing it explicitly
// from node:buffer keeps this route working on older Node runtimes too
// (e.g. whatever LTS happens to be installed on a given deploy target)
// instead of silently depending on an ambient global that may not exist.
// Aliased so the DOM `File` type (used below for annotations) stays intact.

export const maxDuration = 300;

// Duck-typed against what's actually used, rather than DOM's `File` type —
// that type doesn't structurally match node:buffer's `File` (it's missing
// browser-only fields like `webkitRelativePath`), even though both are the
// same object at runtime here.
async function toUploadedFile(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<UploadedFile> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return { name: file.name, buffer };
}

// Streams newline-delimited JSON progress/log events while the batch runs —
// same approach used throughout this project: plain fetch + ReadableStream,
// no SSE/websocket library.
export async function POST(request: NextRequest) {
  let uploadedFiles: UploadedFile[];
  let customTemplate: UploadedFile | null;

  try {
    const form = await request.formData();

    const uploads = form.getAll("files").filter((entry): entry is File => entry instanceof NodeFile);
    if (uploads.length === 0) {
      return new Response(JSON.stringify({ type: "fatal", message: "No files were uploaded." }) + "\n", {
        status: 400,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }

    const customTemplateEntry = form.get("customTemplate");
    customTemplate =
      customTemplateEntry instanceof NodeFile && customTemplateEntry.size > 0
        ? await toUploadedFile(customTemplateEntry)
        : null;

    uploadedFiles = await Promise.all(uploads.map(toUploadedFile));
  } catch (err) {
    // Anything thrown before the response stream starts (bad multipart body,
    // etc.) would otherwise surface as a generic, unlogged HTTP 500 — return
    // the real reason as JSON instead.
    const message = err instanceof Error ? err.message : "Failed to read the uploaded files.";
    console.error("[api/extract] failed to parse upload:", err);
    return new Response(JSON.stringify({ type: "fatal", message }) + "\n", {
      status: 500,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runExtract({ uploadedFiles, customTemplate })) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Extraction failed unexpectedly.";
        controller.enqueue(encoder.encode(JSON.stringify({ type: "fatal", message }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
