export class QpucJsonExtractionError extends Error {}

export interface QpucExtractedQuestion {
  id: string;
  theme?: string;
  answer: string;
  acceptedAnswers: string[];
  clues: string[];
  sourceReference?: string;
}

export interface QpucExtractedQuiz {
  questions: QpucExtractedQuestion[];
}

export function extractQpucQuestionsFromJson(json: string): QpucExtractedQuiz {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new QpucJsonExtractionError("Le JSON n'est pas valide.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new QpucJsonExtractionError("Le JSON doit contenir un objet.");
  }

  const root = parsed as { questions?: unknown; qpuc_questions?: unknown };
  const rawQuestions = Array.isArray(root.questions)
    ? root.questions
    : Array.isArray(root.qpuc_questions)
      ? root.qpuc_questions
      : null;

  if (!rawQuestions) {
    throw new QpucJsonExtractionError('Le JSON doit contenir un tableau "questions".');
  }

  const questions = rawQuestions.map(parseQuestion).filter((question): question is QpucExtractedQuestion => question !== null);

  if (questions.length === 0) {
    throw new QpucJsonExtractionError("Aucune question QPUC exploitable n'a été trouvée.");
  }

  return { questions };
}

function parseQuestion(rawQuestion: unknown, index: number): QpucExtractedQuestion | null {
  if (!rawQuestion || typeof rawQuestion !== "object") {
    return null;
  }

  const question = rawQuestion as {
    id?: unknown;
    theme?: unknown;
    answer?: unknown;
    accepted_answers?: unknown;
    acceptedAnswers?: unknown;
    clues?: unknown;
    indices?: unknown;
    source_reference?: unknown;
    sourceReference?: unknown;
  };
  const answer = typeof question.answer === "string" ? cleanText(question.answer) : "";
  const rawClues = Array.isArray(question.clues) ? question.clues : Array.isArray(question.indices) ? question.indices : [];
  const clues = rawClues.filter((clue): clue is string => typeof clue === "string").map(cleanText).filter(Boolean);
  const rawAcceptedAnswers = Array.isArray(question.accepted_answers)
    ? question.accepted_answers
    : Array.isArray(question.acceptedAnswers)
      ? question.acceptedAnswers
      : [];
  const acceptedAnswers = rawAcceptedAnswers
    .filter((acceptedAnswer): acceptedAnswer is string => typeof acceptedAnswer === "string")
    .map(cleanText)
    .filter(Boolean);

  if (!answer || clues.length < 4) {
    return null;
  }

  return {
    id: typeof question.id === "string" && question.id.trim() ? question.id.trim() : `qpuc-${index + 1}`,
    theme: typeof question.theme === "string" && question.theme.trim() ? cleanText(question.theme) : undefined,
    answer,
    acceptedAnswers: [...new Set([answer, ...acceptedAnswers])],
    clues,
    sourceReference:
      typeof question.source_reference === "string" && question.source_reference.trim()
        ? cleanText(question.source_reference)
        : typeof question.sourceReference === "string" && question.sourceReference.trim()
          ? cleanText(question.sourceReference)
          : undefined
  };
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
