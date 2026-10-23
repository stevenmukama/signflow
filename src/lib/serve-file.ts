import { readFile } from 'fs/promises'
import { NextResponse } from 'next/server'

/**
 * Serve a file from disk as the HTTP response with the correct content type
 * and optional Content-Disposition (inline vs attachment).
 */
export async function serveFile(
  filePath: string,
  mimeType: string,
  opts: { downloadName?: string; attachment?: boolean } = {},
): Promise<Response> {
  try {
    const buf = await readFile(filePath)
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    }
    if (opts.downloadName) {
      const disp = opts.attachment ? 'attachment' : 'inline'
      headers['Content-Disposition'] =
        `${disp}; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`
    }
    return new Response(new Uint8Array(buf), { headers })
  } catch {
    return NextResponse.json(
      { error: 'File not found on disk' },
      { status: 404 },
    )
  }
}
