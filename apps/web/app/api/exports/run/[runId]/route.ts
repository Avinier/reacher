import { NextResponse } from "next/server";
import { z } from "zod";
import { runCsv, runJson, runMarkdown } from "@/lib/exports/format";

const formatSchema = z.enum(["markdown", "csv", "json"]);

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const format = formatSchema.parse(new URL(request.url).searchParams.get("format") ?? "markdown");

  if (format === "csv") {
    return new NextResponse(runCsv(runId), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${runId}.csv"`
      }
    });
  }

  if (format === "json") {
    return new NextResponse(runJson(runId), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${runId}.json"`
      }
    });
  }

  return new NextResponse(runMarkdown(runId), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${runId}.md"`
    }
  });
}
