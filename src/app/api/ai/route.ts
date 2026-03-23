/**
 * POST /api/ai
 * Body: { question: string }
 * Response: { answer: string; source: 'elfa' | 'gemini'; cached: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { routeQuery } from '@/lib/ai/router';

// Vercel max execution time
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question: string = (body?.question ?? '').trim();

    if (!question) {
      return NextResponse.json(
        { error: 'Soru boş olamaz.' },
        { status: 400 }
      );
    }

    if (question.length > 500) {
      return NextResponse.json(
        { error: 'Soru 500 karakterden uzun olamaz.' },
        { status: 400 }
      );
    }

    const result = await routeQuery(question);
    return NextResponse.json(result);

  } catch (err) {
    console.error('[AI Route Error]', err);
    return NextResponse.json(
      { error: 'AI servisi şu an yanıt vermiyor, lütfen tekrar dene.' },
      { status: 500 }
    );
  }
}
