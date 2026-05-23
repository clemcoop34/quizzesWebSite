export type ExtractedQuiz = {
  questions: ExtractedQuestion[];
};

export type ExtractedQuestion = {
  id: string | null;
  number: number | null;
  hasImage: boolean;
  statement: string;
  answers: ExtractedAnswer[];
  correction: {
    correctAnswersText?: string;
    generalExplanation?: string;
  };
};

export type ExtractedAnswer = {
  label: string;
  text: string;
  isCorrect: boolean;
  explanation?: string;
};

export class MoodleHtmlExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoodleHtmlExtractionError";
  }
}

export function extractQuizFromMoodleHtml(html: string): ExtractedQuiz {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const questionNodes = Array.from(doc.querySelectorAll<HTMLDivElement>("div.que"));

  if (questionNodes.length === 0) {
    throw new MoodleHtmlExtractionError("Le bloc sélectionné ne convient pas : aucune question Moodle div.que trouvée.");
  }

  const questions = questionNodes.map((questionNode): ExtractedQuestion => {
    const id = questionNode.getAttribute("id");
    const number = parseQuestionNumber(cleanText(questionNode.querySelector(".qno")?.textContent ?? ""));
    const qtextNode = questionNode.querySelector<HTMLElement>(".qtext");

    if (!qtextNode) {
      throw new MoodleHtmlExtractionError("Le bloc sélectionné ne convient pas : une question ne contient pas de .qtext.");
    }

    const hasImage = Boolean(qtextNode?.querySelector("img"));
    const statement = extractTextWithoutImages(qtextNode);
    const answerNodes = Array.from(questionNode.querySelectorAll<HTMLElement>(".answer > div"));

    if (!statement) {
      throw new MoodleHtmlExtractionError("Le bloc sélectionné ne convient pas : un énoncé est vide.");
    }

    if (answerNodes.length === 0) {
      throw new MoodleHtmlExtractionError(
        "Le bloc sélectionné ne convient pas : une question ne contient pas de propositions .answer > div."
      );
    }

    const answers = answerNodes
      .map((answerNode): ExtractedAnswer => {
        const label = cleanText(answerNode.querySelector(".answernumber")?.textContent ?? "").replace(/\.$/, "");
        const textNode = answerNode.querySelector<HTMLElement>(".flex-fill");
        const text = textNode ? extractAnswerText(textNode) : "";
        const isCorrect =
          answerNode.classList.contains("correct") || answerNode.classList.contains("correctnotchecked");
        const explanation = cleanText(answerNode.querySelector(".specificfeedback")?.textContent ?? "");

        return {
          label,
          text,
          isCorrect,
          ...(explanation ? { explanation } : {})
        };
      })
      .filter((answer) => answer.text);

    if (answers.length === 0) {
      throw new MoodleHtmlExtractionError("Le bloc sélectionné ne convient pas : les propositions sont vides.");
    }

    const correctAnswersText = cleanText(questionNode.querySelector(".rightanswer")?.textContent ?? "").replace(
      /^(les?|la)\s+réponses?\s+correctes?\s+(sont|est)\s*:\s*/i,
      ""
    );
    const generalExplanation = cleanText(questionNode.querySelector(".generalfeedback")?.textContent ?? "");

    return {
      id,
      number,
      hasImage,
      statement,
      answers,
      correction: {
        ...(correctAnswersText ? { correctAnswersText } : {}),
        ...(generalExplanation ? { generalExplanation } : {})
      }
    };
  });

  return { questions };
}

function extractTextWithoutImages(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement;

  clone.querySelectorAll("img, .questionflagimage").forEach((item) => item.remove());

  return cleanText(clone.textContent ?? "");
}

function extractAnswerText(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement;

  clone
    .querySelectorAll("img, .questionflagimage, .specificfeedback, .rightanswer, .generalfeedback")
    .forEach((item) => item.remove());

  return cleanText(clone.textContent ?? "");
}

function parseQuestionNumber(value: string): number | null {
  const match = value.match(/\d+/);

  if (!match) {
    return null;
  }

  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
