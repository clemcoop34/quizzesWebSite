"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameFinishedPayload,
  GameQuestionEndedPayload,
  GameQuestionStartedPayload,
  ImagePointDto,
  ImageRegionDto,
  RoomQuizPreviewDto,
  RoomStateDto,
  QuizReportReason,
  ServerToClientEvents
} from "@quiz/shared";

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type QuizSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type QuizPickerItem = {
  id: string;
  title: string;
  correctionPercent?: number;
  sourceType?: string | null;
  sourceCity?: string | null;
  sourceYear?: string | null;
  trainingYear?: string | null;
  _count?: { questions: number };
  quizTags?: Array<{ tag: { name: string } }>;
};

export function RoomClient({ code }: { code: string }) {
  const [displayName, setDisplayName] = useState("");
  const [room, setRoom] = useState<RoomStateDto | null>(null);
  const [question, setQuestion] = useState<GameQuestionStartedPayload | null>(null);
  const [ended, setEnded] = useState<GameQuestionEndedPayload | null>(null);
  const [finished, setFinished] = useState<GameFinishedPayload | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<ImagePointDto | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [answerValidated, setAnswerValidated] = useState(false);
  const [explanationsSkipped, setExplanationsSkipped] = useState(false);
  const [liveScores, setLiveScores] = useState<Record<string, number>>({});
  const [likedQuizIds, setLikedQuizIds] = useState<string[]>([]);
  const [reportedQuizIds, setReportedQuizIds] = useState<string[]>([]);
  const [quizOptions, setQuizOptions] = useState<QuizPickerItem[]>([]);
  const [showQuizPicker, setShowQuizPicker] = useState(false);
  const [quizPickerSearch, setQuizPickerSearch] = useState("");
  const [isLoadingQuizOptions, setIsLoadingQuizOptions] = useState(false);
  const [reportReason, setReportReason] = useState<QuizReportReason | "">("");
  const [showReportModal, setShowReportModal] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<QuizSocket | null>(null);
  const questionPanelRef = useRef<HTMLElement | null>(null);
  const explanationPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const instance: QuizSocket = io(socketUrl, { autoConnect: true });
    socketRef.current = instance;
    instance.on("room:state_updated", (payload) => {
      setIsJoining(false);
      setRoom((previous) => ({
        ...payload,
        currentPlayerId: payload.currentPlayerId ?? previous?.currentPlayerId
      }));

      if (payload.currentPlayerId) {
        setCurrentPlayerId(payload.currentPlayerId);
        window.sessionStorage.setItem(playerStorageKey(code), payload.currentPlayerId);
      }
    });
    instance.on("game:question_started", (payload) => {
      setQuestion(payload);
      setEnded(null);
      setSelectedOptionIds([]);
      setSelectedPoint(null);
      setTextAnswer("");
      setAnswerValidated(false);
      setExplanationsSkipped(false);
      setFinished(null);
    });
    instance.on("game:question_ended", (payload) => {
      setEnded(payload);
      setExplanationsSkipped(false);
      setLiveScores(payload.scores);
    });
    instance.on("game:finished", (payload) => {
      setFinished(payload);
      setLiveScores(payload.scores);
    });
    instance.on("error", (payload) => setError(payload.message));
    instance.on("error", () => setIsJoining(false));

    const storedPlayerId = window.sessionStorage.getItem(playerStorageKey(code));
    if (storedPlayerId) {
      setCurrentPlayerId(storedPlayerId);
    }
    setLikedQuizIds(JSON.parse(window.localStorage.getItem("liked-quiz-ids") ?? "[]") as string[]);
    setReportedQuizIds(JSON.parse(window.localStorage.getItem("reported-quiz-ids") ?? "[]") as string[]);

    instance.emit("room:watch", { code, playerId: storedPlayerId ?? undefined });

    return () => {
      instance.disconnect();
      socketRef.current = null;
    };
  }, [code]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showQuizPicker) {
      return;
    }

    setIsLoadingQuizOptions(true);
    fetch(`${apiUrl}/quizzes`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items: QuizPickerItem[]) => setQuizOptions(items))
      .catch(() => setQuizOptions([]))
      .finally(() => setIsLoadingQuizOptions(false));
  }, [showQuizPicker]);

  useEffect(() => {
    if (!question || !questionPanelRef.current) {
      return;
    }

    questionPanelRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [question?.question.id]);

  useEffect(() => {
    if (!ended || !explanationPanelRef.current) {
      return;
    }

    explanationPanelRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [ended?.questionId]);

  const currentPlayer = room?.players.find((player) => player.id === currentPlayerId);
  const quizPreview: RoomQuizPreviewDto | null = room?.quiz ?? null;
  const hostPlayer = room?.players.find((player) => player.id === room.hostPlayerId);
  const isJoined = Boolean(currentPlayer);
  const isHost = Boolean(currentPlayer?.isHost);
  const isOpenTextQuestion = question?.question.type === "open_text";
  const isImageRegionQuestion = question?.question.type === "image_region";
  const questionOptionLabels = new Map(question?.question.options.map((option) => [option.id, option.label]) ?? []);
  const explanationsByOptionId = new Map(ended?.explanations.map((item) => [item.optionId, item.explanation]) ?? []);
  const playerResultById = new Map(ended?.playerResults.map((result) => [result.playerId, result.status]) ?? []);
  const rankedPlayers = useMemo(
    () =>
      [...(room?.players ?? [])].sort(
        (a, b) => (liveScores[b.id] ?? b.score) - (liveScores[a.id] ?? a.score) || a.displayName.localeCompare(b.displayName)
      ),
    [room?.players, liveScores]
  );
  const filteredQuizOptions = useMemo(() => {
    const tokens = quizPickerSearch
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (tokens.length === 0) {
      return quizOptions;
    }

    return quizOptions.filter((quiz) => {
      const searchableText = [
        quiz.title,
        quiz.sourceCity,
        quiz.sourceYear,
        quiz.trainingYear,
        ...(quiz.quizTags ?? []).map((quizTag) => quizTag.tag.name)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return tokens.every((token) => searchableText.includes(token));
    });
  }, [quizOptions, quizPickerSearch]);
  const remainingRatio = question
    ? Math.max(0, Math.min(1, (Date.parse(question.endsAt) - now) / (Date.parse(question.endsAt) - Date.parse(question.startedAt))))
    : 0;

  function joinRoom() {
    if (isJoined || isJoining) return;

    setError(null);
    setIsJoining(true);
    socketRef.current?.emit("room:join", {
      code,
      displayName: displayName || "Player",
      playerId: currentPlayerId ?? undefined
    });
  }

  function startGame() {
    if (!room?.quizId) {
      setError("Aucun quiz n'est associé à cette room.");
      return;
    }

    socketRef.current?.emit("game:start", {
      roomCode: code,
      quizId: room.quizId,
      modeId: "classic"
    });
  }

  function selectQuiz(quizId: string) {
    setShowQuizPicker(false);
    setError(null);
    socketRef.current?.emit("room:quiz_select", {
      code,
      quizId
    });
  }

  function answer(optionId: string) {
    if (!question || ended || !isJoined) return;

    setAnswerValidated(false);
    setSelectedOptionIds((previous) => {
      const next = previous.includes(optionId)
        ? previous.filter((selectedOptionId) => selectedOptionId !== optionId)
        : [...previous, optionId];

      sendAnswer(next, textAnswer, false, null);

      return next;
    });
  }

  function updateTextAnswer(value: string) {
    setTextAnswer(value);
    setAnswerValidated(false);
    sendAnswer([], value, false, null);
  }

  function updateAnswerValidated(value: boolean) {
    setAnswerValidated(value);
    sendAnswer(selectedOptionIds, textAnswer, value, selectedPoint);
  }

  function selectImagePoint(point: ImagePointDto) {
    if (!question || ended || !isJoined || !isImageRegionQuestion) return;

    setAnswerValidated(false);
    setSelectedPoint(point);
    sendAnswer([], textAnswer, false, point);
  }

  function sendAnswer(
    optionIds: string[],
    answerText: string,
    validated = answerValidated,
    point: ImagePointDto | null = selectedPoint
  ) {
    if (!question || ended || !isJoined) return;

    socketRef.current?.emit("game:answer", {
      sessionId: question.sessionId,
      roomCode: code,
      questionId: question.question.id,
      optionIds,
      textAnswer: answerText,
      selectedPoint: point ?? undefined,
      validated
    });
  }

  async function likeQuiz() {
    if (!room?.quizId || likedQuizIds.includes(room.quizId)) return;

    setIsLiking(true);
    try {
      await fetch(`${apiUrl}/quizzes/${room.quizId}/like`, {
        method: "POST"
      });
      const nextLikedQuizIds = [...likedQuizIds, room.quizId];
      setLikedQuizIds(nextLikedQuizIds);
      window.localStorage.setItem("liked-quiz-ids", JSON.stringify(nextLikedQuizIds));
    } finally {
      setIsLiking(false);
    }
  }

  async function reportQuiz() {
    if (!room?.quizId || !reportReason) return;

    await fetch(`${apiUrl}/quizzes/${room.quizId}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reportReason, reporterKey: getReporterKey() })
    });
    const nextReportedQuizIds = reportedQuizIds.includes(room.quizId)
      ? reportedQuizIds
      : [...reportedQuizIds, room.quizId];
    setReportedQuizIds(nextReportedQuizIds);
    window.localStorage.setItem("reported-quiz-ids", JSON.stringify(nextReportedQuizIds));
    setShowReportModal(false);
    setReportReason("");
  }

  async function copyRoomUrl() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function skipExplanations() {
    if (!question || !ended || explanationsSkipped) return;

    setExplanationsSkipped(true);
    socketRef.current?.emit("game:skip_explanations", {
      sessionId: question.sessionId,
      roomCode: code,
      questionId: question.question.id
    });
  }

  function answerChoiceClass(optionId: string) {
    const classes = ["answer-choice"];

    if (selectedOptionIds.includes(optionId)) {
      classes.push("answer-choice-selected");
    }

    if (ended) {
      classes.push(ended.correctOptionIds.includes(optionId) ? "answer-choice-correct" : "answer-choice-wrong");
    }

    return classes.join(" ");
  }

  return (
    <main className={question && !finished ? "stack game-screen" : "stack"}>
      {question && !finished && rankedPlayers.length > 0 ? (
        <aside className="player-rail" aria-label="Classement live">
          {rankedPlayers.map((player, index) => {
            const resultStatus = playerResultById.get(player.id);

            return (
              <div
                className={resultStatus ? `player-bubble player-bubble-${resultStatus}` : "player-bubble"}
                key={`${player.id}-${ended?.questionId ?? "playing"}`}
                title={`${index + 1}. ${player.displayName}`}
              >
                <span>{player.displayName.trim().charAt(0).toUpperCase() || "?"}</span>
                <small>{liveScores[player.id] ?? player.score}</small>
              </div>
            );
          })}
        </aside>
      ) : null}
      <section className="panel stack">
        <div>
          <h1>{hostPlayer ? `Room de ${hostPlayer.displayName}` : "Room"}</h1>
          <p className="room-code">Code {code}</p>
          <p className="muted">Partage ce code pour inviter un autre joueur.</p>
        </div>

        <div className="row">
          <button type="button" onClick={copyRoomUrl}>
            {copied ? "URL copiée" : "Copier l'URL"}
          </button>
          {!isJoined ? (
            <>
              <input
                aria-label="Nom joueur"
                placeholder="Ton nom"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <button type="button" disabled={isJoining} onClick={joinRoom}>
                {isJoining ? "Connexion..." : "Rejoindre"}
              </button>
            </>
          ) : (
            <span className="muted">Connecté : {currentPlayer?.displayName}</span>
          )}
          {isHost ? (
            <button type="button" disabled={!room?.quizId} onClick={startGame}>
              Lancer
            </button>
          ) : null}
        </div>

        {error ? <p role="alert">{error}</p> : null}
      </section>

      {room && !question && !finished ? (
        <section className="panel stack quiz-preview">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2>Quiz sélectionné</h2>
              <p className="muted">Ce quiz sera lancé dans cette room.</p>
            </div>
            {isHost ? (
              <button className="secondary-button" type="button" onClick={() => setShowQuizPicker(true)}>
                Changer de quiz
              </button>
            ) : null}
          </div>

          {quizPreview ? (
            <article className="quiz-preview-card stack">
              <div>
                <h3>{quizPreview.title}</h3>
                <p className="muted">{quizPreview.questions.length} questions</p>
              </div>
              <div className="compact-meta-list">
                {quizPreview.tags.slice(0, 5).map((tag) => (
                  <span className="compact-pill" key={tag}>
                    {tag}
                  </span>
                ))}
                {quizPreview.correctionPercent && quizPreview.correctionPercent > 5 ? (
                  <span className="compact-pill compact-pill-accent">Corrigé {quizPreview.correctionPercent}%</span>
                ) : null}
                {quizPreview.sourceType === "uness" ? <span className="compact-pill">UNESS</span> : null}
                {quizPreview.sourceCity ? <span className="compact-pill">{quizPreview.sourceCity}</span> : null}
                {quizPreview.sourceYear ? <span className="compact-pill">{quizPreview.sourceYear}</span> : null}
                {quizPreview.trainingYear ? <span className="compact-pill">{quizPreview.trainingYear}</span> : null}
              </div>
              <div className="stack">
                {quizPreview.questions.slice(0, 3).map((previewQuestion, index) => (
                  <p className="quiz-preview-question" key={previewQuestion.id}>
                    <strong>{index + 1}.</strong> {previewQuestion.prompt}
                  </p>
                ))}
                {quizPreview.questions.length > 3 ? (
                  <p className="muted">+{quizPreview.questions.length - 3} autres questions</p>
                ) : null}
              </div>
            </article>
          ) : room.quizId ? (
            <p className="muted">Chargement de l'aperçu du quiz...</p>
          ) : (
            <p className="muted">Aucun quiz n'est encore associé à cette room.</p>
          )}
        </section>
      ) : null}

      {room ? (
        <section className="grid">
          {room.players.map((player) => (
            <article className="card" key={player.id}>
              <strong>{player.displayName}</strong>
              <p className="muted">
                <span className="score-pop" key={liveScores[player.id] ?? player.score}>
                  {liveScores[player.id] ?? player.score}
                </span>{" "}
                points
              </p>
            </article>
          ))}
        </section>
      ) : null}

      {question && !finished ? (
        <section className="panel stack" ref={questionPanelRef}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <p className="muted">
              Question {question.questionIndex + 1} / {question.totalQuestions}
            </p>
            <p className="muted">{Math.ceil(Math.max(0, Date.parse(question.endsAt) - now) / 1000)}s</p>
          </div>
          <div className="timer-track" aria-hidden="true">
            <div className="timer-fill" style={{ width: `${remainingRatio * 100}%` }} />
          </div>
          <h2>{question.question.prompt}</h2>
          {question.question.imageUrl && !isImageRegionQuestion ? (
            <img className="question-image" src={question.question.imageUrl} alt="" />
          ) : null}
          {isImageRegionQuestion ? (
            <ImageRegionPlayer
              correctRegions={ended?.correctRegions ?? []}
              disabled={Boolean(ended) || !isJoined}
              imageUrl={question.question.imageUrl}
              selectedPoint={selectedPoint}
              showCorrectRegions={Boolean(ended)}
              onSelect={selectImagePoint}
            />
          ) : isOpenTextQuestion ? (
            <input
              disabled={Boolean(ended) || !isJoined}
              placeholder="Ta réponse"
              value={textAnswer}
              onChange={(event) => updateTextAnswer(event.target.value)}
            />
          ) : (
            <div className="grid">
              {question.question.options.map((option) => (
                <button
                  className={answerChoiceClass(option.id)}
                  disabled={Boolean(ended) || !isJoined}
                  key={option.id}
                  type="button"
                  onClick={() => answer(option.id)}
                >
                  <span>{option.label}</span>
                  {explanationsByOptionId.has(option.id) ? (
                    <small className="answer-explanation">{explanationsByOptionId.get(option.id)}</small>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {!ended ? (
            <button
              aria-pressed={answerValidated}
              className={answerValidated ? "commit-answer-button commit-answer-button-active" : "commit-answer-button"}
              disabled={!isJoined}
              type="button"
              onClick={() => updateAnswerValidated(!answerValidated)}
            >
              {answerValidated ? "Réponse validée" : "Valider ma réponse"}
            </button>
          ) : null}
          {ended ? (
            <div className="explanation-panel stack" ref={explanationPanelRef}>
              {isImageRegionQuestion ? (
                ended.questionExplanation ? <p className="muted">{ended.questionExplanation}</p> : null
              ) : (
                <p className="muted">
                  Bonne réponse :{" "}
                  {ended.correctOptionIds.map((optionId) => questionOptionLabels.get(optionId) ?? optionId).join(", ")}
                </p>
              )}
              {isHost ? (
                <button
                  className="commit-answer-button"
                  disabled={explanationsSkipped}
                  type="button"
                  onClick={skipExplanations}
                >
                  {explanationsSkipped ? "Passage en cours..." : "Passer les explications"}
                </button>
              ) : (
                <p className="muted">En attente du créateur de la room pour passer à la suite.</p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {finished ? (
        <section className="panel stack">
          <h2>Scores finaux</h2>
          {finished.ranking.map((entry, index) => (
            <div className={entry.playerId === currentPlayerId ? "row final-score-row final-score-current" : "row final-score-row"} key={entry.playerId}>
              <strong>{index + 1}.</strong>
              <span>{room?.players.find((player) => player.id === entry.playerId)?.displayName ?? entry.playerId}</span>
              <span>{entry.score} points</span>
            </div>
          ))}
          {room?.quizId ? (
            <div className="row">
              <button type="button" disabled={likedQuizIds.includes(room.quizId) || isLiking} onClick={likeQuiz}>
                {likedQuizIds.includes(room.quizId) ? "Quiz liké" : "Liker ce quiz"}
              </button>
              <button
                className="secondary-button"
                disabled={reportedQuizIds.includes(room.quizId)}
                type="button"
                onClick={() => setShowReportModal(true)}
              >
                {reportedQuizIds.includes(room.quizId) ? "Quiz signalé" : "Signaler ce quiz"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {showReportModal ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal stack"
            onSubmit={(event) => {
              event.preventDefault();
              void reportQuiz();
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
              <input checked={reportReason === "other"} onChange={() => setReportReason("other")} type="radio" />
              Autres
            </label>
            <label className="checkbox-label">
              <input
                checked={reportReason === "incorrect_uness_metadata"}
                onChange={() => setReportReason("incorrect_uness_metadata")}
                type="radio"
              />
              Métadonnées UNESS incorrectes
            </label>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="secondary-button" type="button" onClick={() => setShowReportModal(false)}>
                Annuler
              </button>
              <button type="submit" disabled={!reportReason}>
                Signaler
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {showQuizPicker ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal quiz-picker-modal stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Choisir un quiz</h2>
              <button className="secondary-button" type="button" onClick={() => setShowQuizPicker(false)}>
                Fermer
              </button>
            </div>
            {isLoadingQuizOptions ? <p className="muted">Chargement des quiz...</p> : null}
            <input
              aria-label="Rechercher un quiz"
              placeholder="Rechercher par titre, tag, ville, année..."
              value={quizPickerSearch}
              onChange={(event) => setQuizPickerSearch(event.target.value)}
            />
            <div className="stack quiz-picker-list">
              {filteredQuizOptions.map((quiz) => (
                <button
                  className={quiz.id === room?.quizId ? "quiz-picker-item quiz-picker-item-selected" : "quiz-picker-item"}
                  key={quiz.id}
                  type="button"
                  onClick={() => selectQuiz(quiz.id)}
                >
                  <span>
                    <strong>{quiz.title}</strong>
                    <small>
                      {quiz._count?.questions ?? 0} questions
                      {quiz.sourceType === "uness" ? " · UNESS" : ""}
                      {quiz.sourceCity ? ` · ${quiz.sourceCity}` : ""}
                      {quiz.sourceYear ? ` · ${quiz.sourceYear}` : ""}
                    </small>
                  </span>
                  {quiz.correctionPercent && quiz.correctionPercent > 5 ? (
                    <small>Corrigé {quiz.correctionPercent}%</small>
                  ) : null}
                </button>
              ))}
              {!isLoadingQuizOptions && filteredQuizOptions.length === 0 ? (
                <p className="muted">Aucun quiz ne correspond à cette recherche.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
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

function toSvgPoints(points: ImagePointDto[]): string {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function playerStorageKey(code: string) {
  return `quiz-room:${code}:player-id`;
}

function getReporterKey() {
  const existingKey = window.localStorage.getItem("quiz-reporter-key");

  if (existingKey) {
    return existingKey;
  }

  const key = crypto.randomUUID();
  window.localStorage.setItem("quiz-reporter-key", key);
  return key;
}
