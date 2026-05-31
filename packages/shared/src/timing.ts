export const CLASSIC_TIMING_CONFIG = {
  fallbackQuestionDurationMs: 20_000,
  baseQuestionTimeMs: 8_000,
  timePerWordMs: 650,
  minQuestionDurationMs: 12_000,
  maxQuestionDurationMs: 90_000
};

export interface TimedQuestionTextInput {
  prompt: string;
  options?: Array<{ label: string }>;
  acceptedTextAnswers?: string[];
}

export function calculateClassicQuestionDurationMs(question: TimedQuestionTextInput): number {
  const wordCount = countWords([
    question.prompt,
    ...(question.options ?? []).map((option) => option.label),
    ...(question.acceptedTextAnswers ?? [])
  ].join(" "));

  if (wordCount === 0) {
    return CLASSIC_TIMING_CONFIG.fallbackQuestionDurationMs;
  }

  const durationMs = CLASSIC_TIMING_CONFIG.baseQuestionTimeMs + wordCount * CLASSIC_TIMING_CONFIG.timePerWordMs;

  return clamp(
    Math.round(durationMs),
    CLASSIC_TIMING_CONFIG.minQuestionDurationMs,
    CLASSIC_TIMING_CONFIG.maxQuestionDurationMs
  );
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
