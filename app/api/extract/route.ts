import { NextRequest } from "next/server";
import { runExtract, type UploadedFile } from "@/lib/run-extract";

export const maxDuration = 300;

async function toUploadedFile(file: File): Promise<UploadedFile> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return { name: file.name, buffer };
}

// Streams newline-delimited JSON progress/log events while the batch runs —
// same approach used throughout this project: plain fetch + ReadableStream,
// no SSE/websocket library.
export async function POST(request: NextRequest) {
  const form = await request.formData();

  const uploads = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (uploads.length === 0) {
    return new Response(JSON.stringify({ type: "fatal", message: "No files were uploaded." }) + "\n", {
      status: 400,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const customTemplateEntry = form.get("customTemplate");
  const customTemplate =
    customTemplateEntry instanceof File && customTemplateEntry.size > 0
      ? await toUploadedFile(customTemplateEntry)
      : null;

  const uploadedFiles = await Promise.all(uploads.map(toUploadedFile));

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
