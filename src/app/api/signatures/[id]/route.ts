import { NextResponse } from 'next/server'

import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * DELETE /api/signatures/[id] — remove a saved signature.
 * Returns { ok: true } on success, or a 404 JSON error when it does not exist.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Next.js 16: dynamic route params arrive as a Promise.
    const { id } = await params

    const existing = await db.signature.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Signature not found.' }, { status: 404 })
    }

    await db.signature.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/signatures/[id] failed:', error)
    return NextResponse.json({ error: 'Failed to delete the signature.' }, { status: 500 })
  }
}
