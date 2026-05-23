export type DocumentQuizExtraction = {
  questions: DocumentExtractedQuestion[];
};

export type DocumentExtractedQuestion = {
  difficulty: "facile" | "moyen" | "difficile";
  sourceTopic: string;
  question: string;
  items: DocumentExtractedItem[];
};

export type DocumentExtractedItem = {
  label: string;
  text: string;
  isCorrect: boolean;
  explanation?: string;
};

type RawDocumentQuiz = {
  quiz_count?: unknown;
  quizzes?: unknown;
};

type RawDocumentQuestion = {
  difficulty?: unknown;
  source_topic?: unknown;
  question?: unknown;
  items?: unknown;
};

type RawDocumentItem = {
  label?: unknown;
  text?: unknown;
  is_correct?: unknown;
  explanation?: unknown;
};

export class DocumentJsonExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentJsonExtractionError";
  }
}

export function extractQuizFromDocumentJson(json: string): DocumentQuizExtraction {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DocumentJsonExtractionError("Le fichier ne contient pas un JSON valide.");
  }

  if (!isObject(parsed)) {
    throw new DocumentJsonExtractionError("Le JSON doit être un objet.");
  }

  const payload = parsed as RawDocumentQuiz;

  if (!Array.isArray(payload.quizzes)) {
    throw new DocumentJsonExtractionError('Le JSON doit contenir un tableau "quizzes".');
  }

  if (typeof payload.quiz_count === "number" && payload.quiz_count !== payload.quizzes.length) {
    throw new DocumentJsonExtractionError("Le nombre indiqué dans quiz_count ne correspond pas au nombre de quiz.");
  }

  const questions = payload.quizzes.map((rawQuestion, index) =>
    parseDocumentQuestion(rawQuestion, index + 1)
  );

  if (questions.length === 0) {
    throw new DocumentJsonExtractionError("Le JSON ne contient aucune question exploitable.");
  }

  return { questions };
}

function parseDocumentQuestion(rawQuestion: unknown, index: number): DocumentExtractedQuestion {
  if (!isObject(rawQuestion)) {
    throw new DocumentJsonExtractionError(`Question ${index}: l'entrée doit être un objet.`);
  }

  const question = rawQuestion as RawDocumentQuestion;
  const statement = cleanText(readString(question.question));
  const difficulty = parseDifficulty(question.difficulty, index);
  const sourceTopic = cleanText(readString(question.source_topic));

  if (!statement) {
    throw new DocumentJsonExtractionError(`Question ${index}: l'énoncé est manquant.`);
  }

  if (!sourceTopic) {
    throw new DocumentJsonExtractionError(`Question ${index}: source_topic est manquant.`);
  }

  if (!Array.isArray(question.items)) {
    throw new DocumentJsonExtractionError(`Question ${index}: items doit être un tableau.`);
  }

  if (question.items.length !== 5) {
    throw new DocumentJsonExtractionError(`Question ${index}: exactement 5 propositions sont requises.`);
  }

  const items = question.items.map((item, itemIndex) => parseDocumentItem(item, index, itemIndex));
  const correctItemsCount = items.filter((item) => item.isCorrect).length;

  if (correctItemsCount < 1 || correctItemsCount > 4) {
    throw new DocumentJsonExtractionError(`Question ${index}: il faut entre 1 et 4 propositions vraies.`);
  }

  return {
    difficulty,
    sourceTopic,
    question: statement,
    items
  };
}

function parseDocumentItem(rawItem: unknown, questionIndex: number, itemIndex: number): DocumentExtractedItem {
  if (!isObject(rawItem)) {
    throw new DocumentJsonExtractionError(`Question ${questionIndex}, item ${itemIndex + 1}: l'item doit être un objet.`);
  }

  const item = rawItem as RawDocumentItem;
  const label = cleanText(readString(item.label)) || "ABCDE"[itemIndex] || String(itemIndex + 1);
  const text = cleanText(readString(item.text));

  if (!text) {
    throw new DocumentJsonExtractionError(`Question ${questionIndex}, item ${label}: la proposition est vide.`);
  }

  if (typeof item.is_correct !== "boolean") {
    throw new DocumentJsonExtractionError(`Question ${questionIndex}, item ${label}: is_correct doit être true ou false.`);
  }

  const explanation = item.explanation === null ? "" : cleanText(readString(item.explanation));

  return {
    label,
    text,
    isCorrect: item.is_correct,
    ...(explanation ? { explanation } : {})
  };
}

function parseDifficulty(value: unknown, questionIndex: number): DocumentExtractedQuestion["difficulty"] {
  if (value === "facile" || value === "moyen" || value === "difficile") {
    return value;
  }

  throw new DocumentJsonExtractionError(
    `Question ${questionIndex}: difficulty doit valoir "facile", "moyen" ou "difficile".`
  );
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
