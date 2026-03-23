/**
 * POST /api/ai
 * Body: { question: string }
 * Response: { answer: string; source: 'elfa' | 'gemini'; cached: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { routeQuery } from '@/lib/ai/router';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question: string = (body?.question ?? '').trim();

    if (!question) {
      return NextResponse.json({ error: 'Soru boş olamaz.' }, { status: 400 });
    }

    if (question.length > 500) {
      return NextResponse.json({ error: 'Soru 500 karakterden uzun olamaz.' }, { status: 400 });
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY Vercel ortamında tanımlı değil!' },
        { status: 500 }
      );
    }

    const result = await routeQuery(question);
    return NextResponse.json(result);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AI Route Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
