import { NextResponse, type NextRequest } from 'next/server'
import { err } from '@/shared/schemas'

export const dynamic = 'force-dynamic'

interface Ctx {
  // Next 16: route params are async — always await.
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  return NextResponse.json(
    err('NOT_IMPLEMENTED', `Detail for ${id} lands in feature: saved-hedges.`),
    { status: 501 }
  )
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  return NextResponse.json(
    err('NOT_IMPLEMENTED', `Delete for ${id} lands in feature: saved-hedges.`),
    { status: 501 }
  )
}
