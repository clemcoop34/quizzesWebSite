"use client";

import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { calculateClassicQuestionDurationMs, type GameQuestionTimingMode, type ImagePointDto, type ImageRegionDto, type QuizReportReason } from "@quiz/shared";

interface SoloQuiz {
  id: string;
  title: string;
  questions: Array<{
    id: string;
    type: "MULTIPLE_CHOICE" | "IMAGE_MULTIPLE_CHOICE" | "IMAGE_REGION" | "OPEN_TEXT";
    prompt: string;
    imageUrl?: string | null;
    imageRegions?: ImageRegionDto[];
    imageRegionExplanation?: string | null;
    acceptedTextAnswers: string[];
    durationMs: number;
    answerOptions: Array<{
      id: string;
      label: string;
      isCorrect: boolean;
      explanation?: string | null;
    }>;
  }>;
}

type SoloPhase = "idle" | "playing" | "review" | "finished";
type SoloAnswer = { optionIds: string[]; textAnswer: string; selectedPoint?: ImagePointDto };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function SoloQuizClient({ quiz }: { quiz: SoloQuiz }) {
  const [phase, setPhase] = useState<SoloPhase>("idle");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<ImagePointDto | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [answerValidated, setAnswerValidated] = useState(false);
  const [timingMode, setTimingMode] = useState<GameQuestionTimingMode>("dynamic_timer");
  const [selectedQuestionCount, setSelectedQuestionCount] = useState(quiz.questions.length);
  const [answers, setAnswers] = useState<Record<string, SoloAnswer>>({});
  const [sessionQuestions, setSessionQuestions] = useState(() => quiz.questions);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [likedQuizIds, setLikedQuizIds] = useState<string[]>([]);
  const [reportedQuizIds, setReportedQuizIds] = useState<string[]>([]);
  const [reportReason, setReportReason] = useState<QuizReportReason | "">("");
  const [showReportModal, setShowReportModal] = useState(false);

  const question = sessionQuestions[questionIndex];
  const currentQuestionDurationMs = question
    ? calculateClassicQuestionDurationMs({
        prompt: question.prompt,
        options: question.answerOptions,
        acceptedTextAnswers: question.acceptedTextAnswers
      })
    : 20_000;
  const endsAt = startedAt + currentQuestionDurationMs;
  const remainingMs = timingMode === "no_timer" ? null : Math.max(0, endsAt - now);
  const remainingRatio =
    question && timingMode === "dynamic_timer" ? Math.max(0, Math.min(1, (remainingMs ?? 0) / currentQuestionDurationMs)) : 0;
  const score = useMemo(
    () => sessionQuestions.reduce((total, candidate) => total + gradeSoloAnswer(candidate, answers[candidate.id]).scoreRatio, 0),
    [sessionQuestions, answers]
  );
  const currentCorrectOptionIds = question?.answerOptions.filter((option) => option.isCorrect).map((option) => option.id) ?? [];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLikedQuizIds(readLocalStorageStringArray("liked-quiz-ids"));
    setReportedQuizIds(readLocalStorageStringArray("reported-quiz-ids"));
  }, []);

  useEffect(() => {
    if (phase !== "playing" || timingMode === "no_timer" || (remainingMs ?? 0) > 0) {
      return;
    }

    finishCurrentQuestion();
  }, [phase, remainingMs]);

  function start() {
    const questionLimit = Math.max(1, Math.min(quiz.questions.length, selectedQuestionCount));
    const shuffledQuestions = shuffleArray(quiz.questions).slice(0, questionLimit);
    setSessionQuestions(shuffledQuestions);
    setAnswers({});
    setQuestionIndex(0);
    setSelectedOptionIds([]);
    setSelectedPoint(null);
    setTextAnswer("");
    setAnswerValidated(false);
    setStartedAt(Date.now());
    setNow(Date.now());
    setPhase("playing");
  }

  function toggleOption(optionId: string) {
    if (phase !== "playing") return;

    setSelectedPoint(null);
    setSelectedOptionIds((previous) =>
      previous.includes(optionId) ? previous.filter((id) => id !== optionId) : [...previous, optionId]
    );
  }

  function selectImagePoint(point: ImagePointDto) {
    if (phase !== "playing") return;

    setAnswerValidated(false);
    setSelectedOptionIds([]);
    setSelectedPoint(point);
  }

  function finishCurrentQuestion() {
    if (phase !== "playing") return;

    const nextAnswers = {
      ...answers,
      [question.id]: {
        optionIds: selectedOptionIds,
        textAnswer,
        selectedPoint: selectedPoint ?? undefined
      }
    };
    setAnswers(nextAnswers);
    setPhase("review");
  }

  function validateCurrentAnswer() {
    setAnswerValidated(true);
    finishCurrentQuestion();
  }

  function skipExplanations() {
    goToNextQuestion({
      ...answers,
      [question.id]: {
        optionIds: selectedOptionIds,
        textAnswer,
        selectedPoint: selectedPoint ?? undefined
      }
    });
  }

  function goToNextQuestion(nextAnswers: Record<string, SoloAnswer>) {
    if (questionIndex >= sessionQuestions.length - 1) {
      setPhase("finished");
      return;
    }

    const nextIndex = questionIndex + 1;
    const nextQuestion = sessionQuestions[nextIndex];
    const previousAnswer = nextAnswers[nextQuestion.id];
    setQuestionIndex(nextIndex);
    setSelectedOptionIds(previousAnswer?.optionIds ?? []);
    setSelectedPoint(previousAnswer?.selectedPoint ?? null);
    setTextAnswer(previousAnswer?.textAnswer ?? "");
    setAnswerValidated(false);
    setStartedAt(Date.now());
    setNow(Date.now());
    setPhase("playing");
  }

  function answerChoiceClass(optionId: string) {
    const classes = ["answer-choice"];

    if (selectedOptionIds.includes(optionId)) {
      classes.push("answer-choice-selected");
    }

    if (phase === "review") {
      classes.push(currentCorrectOptionIds.includes(optionId) ? "answer-choice-correct" : "answer-choice-wrong");
    }

    return classes.join(" ");
  }

  async function likeQuiz() {
    if (likedQuizIds.includes(quiz.id)) return;

    await fetch(`${apiUrl}/quizzes/${quiz.id}/like`, { method: "POST" });
    const nextLikedQuizIds = [...likedQuizIds, quiz.id];
    setLikedQuizIds(nextLikedQuizIds);
    window.localStorage.setItem("liked-quiz-ids", JSON.stringify(nextLikedQuizIds));
  }

  async function reportQuiz() {
    if (!reportReason) return;

    await fetch(`${apiUrl}/quizzes/${quiz.id}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reportReason, reporterKey: getReporterKey() })
    });
    const nextReportedQuizIds = reportedQuizIds.includes(quiz.id) ? reportedQuizIds : [...reportedQuizIds, quiz.id];
    setReportedQuizIds(nextReportedQuizIds);
    window.localStorage.setItem("reported-quiz-ids", JSON.stringify(nextReportedQuizIds));
    setShowReportModal(false);
    setReportReason("");
  }

  if (phase === "idle") {
    return (
      <main className="stack">
        <section className="panel stack">
          <h1>{quiz.title}</h1>
          <p className="muted">{quiz.questions.length} questions en solo.</p>
          <div className="timing-options" aria-label="Rythme du quiz">
            <button
              aria-pressed={timingMode === "no_timer"}
              className={timingMode === "no_timer" ? "timing-option timing-option-active" : "timing-option"}
              type="button"
              onClick={() => setTimingMode((current) => (current === "no_timer" ? "dynamic_timer" : "no_timer"))}
            >
              {timingMode === "no_timer" ? "Sans chrono activé" : "Sans chrono"}
            </button>
          </div>
          <label className="question-count-control">
            <span>Questions jouées</span>
            <input
              aria-label="Nombre de questions jouées"
              max={quiz.questions.length}
              min={1}
              type="number"
              value={selectedQuestionCount}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                setSelectedQuestionCount(
                  Number.isFinite(nextValue) ? Math.max(1, Math.min(quiz.questions.length, nextValue)) : quiz.questions.length
                );
              }}
            />
            <small>/ {quiz.questions.length}</small>
          </label>
          <button type="button" onClick={start}>
            Lancer
          </button>
        </section>
      </main>
    );
  }

  if (phase === "finished") {
    return (
      <main className="stack">
        <section className="panel stack">
          <h1>{quiz.title}</h1>
          <h2>
            Score : {score} / {sessionQuestions.length}
          </h2>
          {sessionQuestions.map((finishedQuestion) => {
            const answer = answers[finishedQuestion.id];
            const grade = gradeSoloAnswer(finishedQuestion, answer);
            const correct = grade.status === "perfect";

            return (
              <article className="card stack" key={finishedQuestion.id}>
                <h3>{finishedQuestion.prompt}</h3>
                <p className={correct ? "success-text" : grade.status === "partial" ? "muted" : "danger-text"}>
                  {correct ? "Correct" : grade.status === "partial" ? "Partiellement correct" : "Incorrect"}
                </p>
                {finishedQuestion.answerOptions
                  .filter((option) => option.isCorrect && option.explanation)
                  .map((option) => (
                    <p className="muted" key={option.id}>
                      {option.label} : {option.explanation}
                    </p>
                  ))}
                {finishedQuestion.type === "IMAGE_REGION" && finishedQuestion.imageRegionExplanation ? (
                  <p className="muted">{finishedQuestion.imageRegionExplanation}</p>
                ) : null}
              </article>
            );
          })}
          <div className="row">
            <button type="button" disabled={likedQuizIds.includes(quiz.id)} onClick={likeQuiz}>
              {likedQuizIds.includes(quiz.id) ? "Quiz liké" : "Liker ce quiz"}
            </button>
            <button
              className="secondary-button"
              disabled={reportedQuizIds.includes(quiz.id)}
              type="button"
              onClick={() => setShowReportModal(true)}
            >
              {reportedQuizIds.includes(quiz.id) ? "Quiz signalé" : "Signaler ce quiz"}
            </button>
          </div>
        </section>
        {showReportModal ? (
          <ReportModal
            reportReason={reportReason}
            setReportReason={setReportReason}
            onClose={() => setShowReportModal(false)}
            onSubmit={reportQuiz}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main className="stack">
      <section className="grid">
        <article className="card">
          <strong>Solo</strong>
          <p className="muted">
            <span className="score-pop" key={score}>
              {score}
            </span>{" "}
            points
          </p>
        </article>
      </section>

      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <p className="muted">
            Question {questionIndex + 1} / {sessionQuestions.length}
          </p>
          <p className="muted">{timingMode === "no_timer" ? "Sans chrono" : `${Math.ceil((remainingMs ?? 0) / 1000)}s`}</p>
        </div>
        {timingMode === "no_timer" ? (
          <div className="no-timer-track">La question passera quand tu auras validé ta réponse.</div>
        ) : (
          <div className="timer-track" aria-hidden="true">
            <div className="timer-fill" style={{ width: `${remainingRatio * 100}%` }} />
          </div>
        )}
        <h1>{quiz.title}</h1>
        <h2>{question.prompt}</h2>
        {question.imageUrl && question.type !== "IMAGE_REGION" ? <img className="question-image" src={question.imageUrl} alt="" /> : null}
        {question.type === "IMAGE_REGION" ? (
          <ImageRegionPlayer
            correctRegions={phase === "review" ? question.imageRegions ?? [] : []}
            disabled={phase !== "playing"}
            imageUrl={question.imageUrl ?? undefined}
            selectedPoint={selectedPoint}
            showCorrectRegions={phase === "review"}
            onSelect={selectImagePoint}
          />
        ) : question.type === "OPEN_TEXT" ? (
          <input
            disabled={phase !== "playing"}
            value={textAnswer}
            onChange={(event) => setTextAnswer(event.target.value)}
            placeholder="Ta réponse"
          />
        ) : (
          <div className="grid">
            {question.answerOptions.map((option) => (
              <button
                className={answerChoiceClass(option.id)}
                disabled={phase !== "playing"}
                key={option.id}
                type="button"
                onClick={() => toggleOption(option.id)}
              >
                <span>{option.label}</span>
                {phase === "review" && option.explanation ? (
                  <small className="answer-explanation">{option.explanation}</small>
                ) : null}
              </button>
            ))}
          </div>
        )}
        {phase === "review" ? (
          <div className="explanation-panel stack">
            {question.type === "IMAGE_REGION" ? (
              question.imageRegionExplanation ? <p className="muted">{question.imageRegionExplanation}</p> : null
            ) : (
              <p className="muted">
                Bonne réponse :{" "}
                {question.type === "OPEN_TEXT"
                  ? question.acceptedTextAnswers.join(", ")
                  : currentCorrectOptionIds
                      .map((optionId) => question.answerOptions.find((option) => option.id === optionId)?.label ?? optionId)
                      .join(", ")}
              </p>
            )}
            <button className="commit-answer-button" type="button" onClick={skipExplanations}>
              Passer les explications
            </button>
          </div>
        ) : null}
        {phase === "playing" ? (
          <button
            aria-pressed={answerValidated}
            className={answerValidated ? "commit-answer-button commit-answer-button-active" : "commit-answer-button"}
            type="button"
          onClick={validateCurrentAnswer}
        >
            {answerValidated ? "Réponse validée" : timingMode === "no_timer" ? "Valider et passer à la correction" : "Valider ma réponse"}
          </button>
        ) : null}
      </section>
    </main>
  );
}

function ImageRegionPlayer({
  correctRegions,
  disabled,
  imageUrl,
  selectedPoint,
  showCorrectRegions,
  onSelect
}: {
  correctRegions: ImageRegionDto[];
  disabled: boolean;
  imageUrl?: string;
  selectedPoint: ImagePointDto | null;
  showCorrectRegions: boolean;
  onSelect: (point: ImagePointDto) => void;
}) {
  if (!imageUrl) {
    return <p className="inline-error">Image indisponible pour cette question.</p>;
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled) return;

    const rect = event.currentTarget.getBoundingClientRect();
    onSelect({
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height)
    });
  }

  return (
    <button
      aria-label="Sélectionner une zone sur l'image"
      className="image-region-player"
      disabled={disabled}
      type="button"
      onPointerDown={handlePointerDown}
    >
      <img className="question-image" src={imageUrl} alt="" draggable={false} />
      <svg className="image-region-answer-overlay" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
        {showCorrectRegions
          ? correctRegions.map((region) => (
              <polygon className="image-region-polygon" key={region.id} points={toSvgPoints(region.points)} />
            ))
          : null}
      </svg>
      {selectedPoint ? (
        <span
          className={showCorrectRegions ? "image-click-marker image-click-marker-final" : "image-click-marker"}
          style={{
            left: `${selectedPoint.x * 100}%`,
            top: `${selectedPoint.y * 100}%`
          }}
        />
      ) : (
        <span className="image-region-placeholder">Clique sur l'image pour placer ton pointeur.</span>
      )}
    </button>
  );
}

function ReportModal({
  reportReason,
  setReportReason,
  onClose,
  onSubmit
}: {
  reportReason: QuizReportReason | "";
  setReportReason: (reason: QuizReportReason | "") => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal stack"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <h2>Signaler le quiz</h2>
        <label className="checkbox-label">
          <input
            checked={reportReason === "wrong_content"}
            onChange={() => setReportReason("wrong_content")}
            type="radio"
          />
          Énoncés / réponses fausses
        </label>
        <label className="checkbox-label">
          <input
            checked={reportReason === "offensive_content"}
            onChange={() => setReportReason("offensive_content")}
            type="radio"
          />
          Contenu offensant
        </label>
        <label className="checkbox-label">
          <input
            checked={reportReason === "incorrect_uness_metadata"}
            onChange={() => setReportReason("incorrect_uness_metadata")}
            type="radio"
          />
          Métadonnées UNESS incorrectes
        </label>
        <label className="checkbox-label">
          <input checked={reportReason === "other"} onChange={() => setReportReason("other")} type="radio" />
          Autres
        </label>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="secondary-button" type="button" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" disabled={!reportReason}>
            Signaler
          </button>
        </div>
      </form>
    </div>
  );
}

function gradeSoloAnswer(question: SoloQuiz["questions"][number], answer?: SoloAnswer) {
  if (!answer) {
    return { mistakes: 1, scoreRatio: 0, status: "wrong" as const };
  }

  if (question.type === "OPEN_TEXT") {
    const isCorrect = question.acceptedTextAnswers.some(
      (acceptedAnswer) => normalizeText(acceptedAnswer) === normalizeText(answer.textAnswer)
    );

    return {
      mistakes: isCorrect ? 0 : 1,
      scoreRatio: isCorrect ? 1 : 0,
      status: isCorrect ? ("perfect" as const) : ("wrong" as const)
    };
  }

  if (question.type === "IMAGE_REGION") {
    const isCorrect =
      Boolean(answer.selectedPoint) &&
      (question.imageRegions ?? []).some((region) => isPointInRegion(answer.selectedPoint as ImagePointDto, region));

    return {
      mistakes: isCorrect ? 0 : 1,
      scoreRatio: isCorrect ? 1 : 0,
      status: isCorrect ? ("perfect" as const) : ("wrong" as const)
    };
  }

  const correctOptionIds = question.answerOptions.filter((option) => option.isCorrect).map((option) => option.id);
  const mistakes = countMultipleChoiceMistakes(answer.optionIds, correctOptionIds);
  const scoreRatio = scoreRatioForMistakes(mistakes);

  return {
    mistakes,
    scoreRatio,
    status: scoreRatio === 1 ? ("perfect" as const) : scoreRatio > 0 ? ("partial" as const) : ("wrong" as const)
  };
}

function countMultipleChoiceMistakes(selectedOptionIds: string[], correctOptionIds: string[]): number {
  const selected = new Set(selectedOptionIds);
  const correct = new Set(correctOptionIds);
  const missingCorrectAnswers = correctOptionIds.filter((optionId) => !selected.has(optionId)).length;
  const selectedWrongAnswers = selectedOptionIds.filter((optionId) => !correct.has(optionId)).length;

  return missingCorrectAnswers + selectedWrongAnswers;
}

function scoreRatioForMistakes(mistakes: number): number {
  if (mistakes === 0) return 1;
  if (mistakes === 1) return 0.5;
  if (mistakes === 2) return 0.2;
  return 0;
}

function isPointInRegion(point: ImagePointDto, region: ImageRegionDto): boolean {
  const points = region.points;

  if (points.length < 3) {
    return false;
  }

  let inside = false;

  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const currentPoint = points[current];
    const previousPoint = points[previous];
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function toSvgPoints(points: ImagePointDto[]): string {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function shuffleArray<T>(items: T[]): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function getReporterKey() {
  if (typeof window === "undefined") {
    return "server-render";
  }

  const existingKey = window.localStorage.getItem("quiz-reporter-key");

  if (existingKey) {
    return existingKey;
  }

  const key = crypto.randomUUID();
  window.localStorage.setItem("quiz-reporter-key", key);
  return key;
}

function readLocalStorageStringArray(key: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as string[]) : [];
  } catch {
    return [];
  }
}
