
import { NextRequest, NextResponse } from 'next/server';
import database from '../../../lib/database';

export async function POST(
  req: NextRequest
) {
  try {
    const { creatorId, walletAddress } = await req.json();

    if (!creatorId || !walletAddress) {
      return NextResponse.json({ error: 'creatorId and walletAddress are required' }, { status: 400 });
    }

    const creator = database.createCreator(creatorId, walletAddress);

    return NextResponse.json({
      success: true,
      creator: {
        id: creator.id,
        walletAddress: creator.walletAddress,
        createdAt: creator.createdAt,
        tipLink: `/tip/${creator.id}`,
      },
    });
  } catch (error: any) {
    console.error('Error in POST /api/creator:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
