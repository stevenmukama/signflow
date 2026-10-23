import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import type { SavedSignature } from '@/lib/types'

export const runtime = 'nodejs'

// Signature images are stored as data URLs in SQLite; cap them at ~2MB.
const MAX_DATA_URL_LENGTH = 2 * 1024 * 1024

const VALID_TYPES = ['draw', 'type', 'upload'] as const
type SignatureType = (typeof VALID_TYPES)[number]

interface SignatureRow {
  id: string
  name: string
  type: string
  dataUrl: string
  createdAt: Date
}

/** Map a Prisma row to the shared SavedSignature DTO (dates → ISO strings). */
function toSavedSignature(row: SignatureRow): SavedSignature {
  return {
    id: row.id,
    name: row.name,
    type: row.type as SavedSignature['type'],
    dataUrl: row.dataUrl,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * GET /api/signatures — list all saved signatures, newest first.
 */
export async function GET() {
  try {
    const rows = await db.signature.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json(rows.map(toSavedSignature))
  } catch (error) {
    console.error('GET /api/signatures failed:', error)
    return NextResponse.json({ error: 'Failed to list signatures.' }, { status: 500 })
  }
}

/**
 * POST /api/signatures — create a saved signature.
 * Body: { name: string, type: 'draw' | 'type' | 'upload', dataUrl: string }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      name?: unknown
      type?: unknown
      dataUrl?: unknown
    } | null

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const { name, type, dataUrl } = body

    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'A signature name is required.' }, { status: 400 })
    }
    if (typeof type !== 'string' || !VALID_TYPES.includes(type as SignatureType)) {
      return NextResponse.json(
        { error: "type must be one of 'draw', 'type' or 'upload'." },
        { status: 400 },
      )
    }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return NextResponse.json(
        { error: 'dataUrl must be an image data URL starting with data:image/.' },
        { status: 400 },
      )
    }
    if (dataUrl.length >= MAX_DATA_URL_LENGTH) {
      return NextResponse.json(
        { error: 'Signature image is too large (data URL must stay under ~2MB).' },
        { status: 413 },
      )
    }

    const created = await db.signature.create({
      data: {
        name: name.trim().slice(0, 120),
        type: type as SignatureType,
        dataUrl,
      },
    })

    return NextResponse.json(toSavedSignature(created), { status: 201 })
  } catch (error) {
    console.error('POST /api/signatures failed:', error)
    return NextResponse.json({ error: 'Failed to save the signature.' }, { status: 500 })
  }
}
