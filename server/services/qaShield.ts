import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type { ProjectDetails, QAQuestion, RiskSegment } from '../../shared/types.js';

const MAX_QA_CONTEXT_CHARS = 10000;

export async function generateQAShield(
  project: ProjectDetails,
  riskSegments: RiskSegment[],
): Promise<QAQuestion[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.warn('[qa-shield] GEMINI_API_KEY missing; skipping Q&A generation.');
    return [];
  }

  let slideContext = '';
  for (const slide of project.slides) {
    const parts = [`Slide ${slide.slideNumber}: ${slide.title}`];
    if (slide.content) parts.push(`Content: ${slide.content.slice(0, 500)}`);
    if (slide.speakerNotes) parts.push(`Speaker notes: ${slide.speakerNotes.slice(0, 300)}`);
    const entry = parts.join('\n');
    if (slideContext.length + entry.length + 2 > MAX_QA_CONTEXT_CHARS) {
      slideContext += `\n\n... (${project.slides.length - project.slides.indexOf(slide)} more slides omitted)`;
      break;
    }
    slideContext += (slideContext ? '\n\n' : '') + entry;
  }

  const weakSpots = riskSegments
    .filter((segment) => segment.avgSeverity >= 0.42)
    .slice(0, 10)
    .map(
      (segment) =>
        `Slide ${segment.slideNumber ?? '?'}: ${segment.riskType} (severity: ${segment.avgSeverity.toFixed(2)}) — ${segment.notes}`,
    )
    .join('\n');

  const prompt = `You are analyzing a presentation to predict likely audience questions after the talk.

PRESENTATION CONTENT:
${slideContext}

KNOWN WEAK SPOTS FROM REHEARSALS:
${weakSpots || 'No weak spots identified yet.'}

Generate 5-8 likely questions that an audience member might ask. For each question consider:
1. Content gaps — important topics mentioned but not fully explained
2. Weak spots — areas where the presenter struggled in rehearsals
3. Controversial or bold claims that need backing
4. Technical details that might need clarification
5. Natural follow-up questions

Respond with a JSON array. Each item must have:
- "question": the audience question (string)
- "suggestedAnswer": a concise, confident answer the presenter could give, 2-3 sentences (string)
- "difficulty": "easy" | "medium" | "hard"
- "source": "content_gap" | "weak_spot" | "controversial" | "technical" | "clarification"
- "slideNumber": the most relevant slide number (integer or null)

Respond with ONLY the JSON array, no markdown fences, no other text.`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const text = response.text?.trim() ?? '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[qa-shield] Could not extract JSON array from response.');
      return [];
    }

    let parsed: Array<{
      question: string;
      suggestedAnswer: string;
      difficulty: string;
      source: string;
      slideNumber: number | null;
    }>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.warn('[qa-shield] JSON parse failed:', parseError);
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    return parsed.map((item) => ({
      id: crypto.randomUUID(),
      question: String(item.question ?? ''),
      suggestedAnswer: String(item.suggestedAnswer ?? ''),
      difficulty: (['easy', 'medium', 'hard'].includes(item.difficulty)
        ? item.difficulty
        : 'medium') as QAQuestion['difficulty'],
      source: (
        ['content_gap', 'weak_spot', 'controversial', 'technical', 'clarification'].includes(item.source)
          ? item.source
          : 'clarification'
      ) as QAQuestion['source'],
      slideNumber: typeof item.slideNumber === 'number' ? item.slideNumber : null,
    }));
  } catch (error) {
    console.error('[qa-shield] Failed to generate Q&A:', error);
    return [];
  }
}
