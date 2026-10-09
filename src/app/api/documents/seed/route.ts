// ============================================================
// POST /api/documents/seed - Seed sample legal contracts for testing
// ============================================================
import { NextResponse } from 'next/server';
import { autoSeedSampleDocs, listDocuments } from '@/lib/storage';
import { getAllSampleDocuments } from '@/lib/sampleDocs';

export async function POST() {
  try {
    const beforeCount = listDocuments().length;
    autoSeedSampleDocs();
    const afterCount = listDocuments().length;
    const allSamples = getAllSampleDocuments();

    return NextResponse.json({
      message: 'Sample legal contracts seeded successfully.',
      count: allSamples.length,
      totalDocuments: afterCount,
      alreadyExisted: beforeCount === afterCount,
    });
  } catch (error) {
    console.error('Seeding error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Seeding failed' },
      { status: 500 }
    );
  }
}
