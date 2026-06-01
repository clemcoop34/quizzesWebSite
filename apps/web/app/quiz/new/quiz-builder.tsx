"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { parseQpucProgressiveQuestions, type ImagePointDto, type ImageRegionDto } from "@quiz/shared";
import {
  DocumentJsonExtractionError,
  extractQuizFromDocumentJson,
  type DocumentExtractedQuestion
} from "./document-json-extractor";
import {
  extractQuizFromMoodleHtml,
  MoodleHtmlExtractionError,
  type ExtractedQuestion
} from "./moodle-html-extractor";
import {
  extractQpucQuestionsFromJson,
  QpucJsonExtractionError,
  type QpucExtractedQuestion
} from "./qpuc-json-extractor";

type QuestionType = "multiple_choice" | "image_multiple_choice" | "image_region" | "open_text";

interface DraftQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  imageUrl: string;
  imageRegions: ImageRegionDto[];
  imageRegionExplanation: string;
  options: Array<{ label: string; isCorrect: boolean; explanation: string }>;
  acceptedTextAnswers: string;
  importedCorrection?: ExtractedQuestion["correction"];
  importedFromMoodle?: boolean;
  importedHadImage?: boolean;
  importedDocumentMeta?: {
    difficulty: DocumentExtractedQuestion["difficulty"];
    sourceTopic: string;
  };
}

interface DraftQpucQuestion {
  id: string;
  theme?: string;
  answer: string;
  acceptedAnswers: string[];
  clues: string[];
  sourceReference?: string;
}

interface MetadataOptions {
  cities: string[];
  sourceYears: string[];
  trainingYears: string[];
}

type PersistedQuestionType = "MULTIPLE_CHOICE" | "IMAGE_MULTIPLE_CHOICE" | "IMAGE_REGION" | "OPEN_TEXT";

export interface InitialQuizForBuilder {
  id: string;
  title: string;
  sourceType?: string | null;
  sourceCity?: string | null;
  sourceYear?: string | null;
  trainingYear?: string | null;
  qpucQuestions?: unknown;
  quizTags?: Array<{ tag: { name: string } }>;
  questions?: Array<{
    id: string;
    type: PersistedQuestionType;
    prompt: string;
    imageUrl?: string | null;
    imageRegions?: unknown;
    imageRegionExplanation?: string | null;
    acceptedTextAnswers?: string[];
    answerOptions?: Array<{
      label: string;
      isCorrect: boolean;
      explanation?: string | null;
    }>;
  }>;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const typeLabels: Record<QuestionType, string> = {
  multiple_choice: "QCM classique",
  image_multiple_choice: "Énoncé + image + QCM",
  image_region: "Image à pointer",
  open_text: "Question ouverte"
};

const documentQuizPrompt = `Tu es un expert en pédagogie, en évaluation par QCM et en extraction de connaissances à partir de documents de cours.

Je vais te fournir un document de cours, qui peut être un PDF, un fichier Excel, un PowerPoint ou tout autre support pédagogique.

Objectif :
À partir du contenu du document fourni, génère un JSON contenant exactement {{NOMBRE_DE_QUIZ}} quiz QCM.

Chaque quiz doit respecter strictement les règles suivantes :

1. Structure générale
- Chaque quiz contient :
  - un énoncé clair ;
  - exactement 5 propositions ;
  - pour chaque proposition, un booléen indiquant si elle est vraie ou fausse ;
  - éventuellement une explication courte pour certaines propositions, uniquement si cela aide réellement à comprendre la correction ;
  - un niveau de difficulté : "facile", "moyen" ou "difficile" ;
  - une référence au passage ou à la notion du document utilisée pour construire la question.

2. Contraintes sur les réponses vraies/fausses
- Chaque QCM doit contenir au moins 1 proposition vraie et au moins 1 proposition fausse.
- Chaque QCM doit contenir entre 1 et 4 propositions vraies.
- Il est interdit de créer un QCM avec 5 propositions vraies ou 5 propositions fausses.
- La distribution des bonnes réponses doit varier d’un quiz à l’autre.
- Évite absolument les schémas répétitifs du type :
  - toujours A, B, C, D vrais ;
  - toujours A et C vrais ;
  - toujours 4 propositions vraies et 1 fausse ;
  - toujours la même position pour les propositions fausses.
- Sur l’ensemble des quiz, équilibre autant que possible le nombre total de propositions vraies et fausses.
- Vise une proportion globale proche de 50 % vraies / 50 % fausses, avec une tolérance raisonnable.

3. Création des propositions fausses
Les propositions fausses doivent être plausibles, pédagogiquement utiles et directement liées au contenu du document.

Pour créer une proposition fausse, tu peux utiliser une des stratégies suivantes :
- inversion d’une relation causale ;
- confusion entre deux notions proches ;
- modification d’une condition importante ;
- généralisation excessive ;
- exception présentée comme règle générale ;
- valeur, date, terme ou acteur incorrect mais crédible ;
- omission d’une contrainte essentielle ;
- mélange de deux concepts distincts du document.

Les propositions fausses ne doivent jamais être :
- absurdes ;
- trop faciles à repérer ;
- hors sujet ;
- fondées sur des informations non présentes dans le document ;
- formulées uniquement avec des mots comme "toujours", "jamais", "uniquement" si cela rend la réponse évidente.

4. Fondement documentaire
- Tous les quiz doivent être fondés uniquement sur le document fourni.
- N’utilise pas de connaissances externes, sauf si je te l’autorise explicitement.
- Si une information n’est pas présente ou pas assez claire dans le document, ne crée pas de question dessus.
- Les questions doivent couvrir plusieurs parties du document, pas seulement le début.

5. Difficulté
Génère une difficulté variable :
- environ 30 % de questions faciles ;
- environ 50 % de questions moyennes ;
- environ 20 % de questions difficiles.

Les questions faciles testent la compréhension directe.
Les questions moyennes testent les relations entre notions.
Les questions difficiles testent les nuances, exceptions, conditions, comparaisons ou implications.

6. Format de sortie
Crée un fichier téléchargeable au format .json nommé quiz_document.json.
Le contenu du fichier doit être uniquement un JSON valide, sans texte avant ni après, sans Markdown et sans bloc de code.
Si ton interface ne permet pas de joindre un fichier téléchargeable, retourne alors uniquement le JSON brut, sans texte autour.

Le JSON doit respecter exactement cette structure :

{
  "quiz_count": {{NOMBRE_DE_QUIZ}},
  "global_balance": {
    "total_true_items": 0,
    "total_false_items": 0,
    "comment": ""
  },
  "quizzes": [
    {
      "id": 1,
      "difficulty": "facile | moyen | difficile",
      "source_topic": "Notion ou section du document",
      "question": "Énoncé du QCM",
      "items": [
        {
          "label": "A",
          "text": "Proposition",
          "is_correct": true,
          "explanation": "Explication courte si utile, sinon null"
        },
        {
          "label": "B",
          "text": "Proposition",
          "is_correct": false,
          "explanation": "Explication courte si utile, sinon null"
        },
        {
          "label": "C",
          "text": "Proposition",
          "is_correct": true,
          "explanation": null
        },
        {
          "label": "D",
          "text": "Proposition",
          "is_correct": false,
          "explanation": null
        },
        {
          "label": "E",
          "text": "Proposition",
          "is_correct": false,
          "explanation": null
        }
      ]
    }
  ]
}

7. Contrôle qualité obligatoire avant réponse
Avant de produire le fichier JSON final, vérifie silencieusement que :
- chaque quiz contient exactement 5 items ;
- chaque quiz contient au moins une réponse vraie et au moins une réponse fausse ;
- aucun schéma de réponses vraies/fausses ne se répète trop souvent ;
- les positions des réponses vraies et fausses sont variées ;
- les propositions fausses sont plausibles ;
- chaque question est bien fondée sur le document ;
- le JSON final est valide.

Important :
Ne montre pas ton raisonnement interne.
Ne fournis que le fichier JSON téléchargeable.`;

const qpucCompatibilityPrompt = `Tu es un expert en pédagogie médicale, en extraction de connaissances et en conception de questions progressives inspirées du mode "Face-à-face" de Questions pour un champion.

Je vais te fournir un document de cours, le plus souvent un cours de médecine. Il peut aussi s'agir d'un cours de SHS, de santé publique, de physiologie, d'anatomie, de sémiologie, de pharmacologie ou d'une autre discipline médicale.

Objectif :
À partir du document fourni, génère un fichier JSON permettant d'ajouter une compatibilité "Face-à-face QPUC" à un quiz.

Le principe :
- Chaque question vise une réponse courte et précise : une structure anatomique, une pathologie, un mécanisme, un auteur, un concept, un examen, une molécule, une classification, etc.
- La question est composée de 8 à 10 indices progressifs.
- Les premiers indices doivent être les moins évidents, mais rester justes et utiles.
- Les derniers indices doivent devenir franchement parlants.
- Tous les indices doivent être strictement fondés sur le document fourni. N'invente aucune information externe.

Esprit attendu des indices :
- Pour une structure anatomique : commencer par le type de structure ou des rapports complexes, puis des rapports plus simples, puis la position, la fonction, l'innervation/vascularisation si pertinent, puis un indice très reconnaissable.
- Pour une pathologie : commencer par un mécanisme, un facteur de risque ou une présentation indirecte, puis les signes, examens, complications, traitements ou éléments distinctifs.
- Pour une molécule ou un traitement : commencer par la classe, le mécanisme ou une indication précise, puis les effets, contre-indications, effets indésirables, surveillance, puis le nom attendu.
- Pour un cours de SHS : on peut viser un auteur, un concept ou une théorie, en commençant par les écrits, le contexte, les idées associées ou les influences, puis les éléments les plus reconnaissables.
- Pour tout sujet : évite les indices triviaux au début. L'ordre doit donner une vraie progression du difficile vers le facile.

Contraintes :
- Génère idéalement 10 à 12 questions.
- Chaque question doit contenir entre 8 et 10 indices.
- Chaque réponse attendue doit avoir plusieurs variantes acceptées dès que c'est pertinent : nom complet, terme raccourci, acronyme, synonymes, pluriel/singulier, déterminants omis, forme avec ou sans adjectif, et formulation courante.
- Exemple : si la réponse est "méthode sandwich", accepte aussi "sandwich" et toute formulation courte non ambiguë présente ou directement déduite du document.
- Ne sois pas minimaliste sur accepted_answers : il vaut mieux fournir 3 à 8 variantes utiles quand la notion s'y prête.
- Les questions doivent couvrir plusieurs parties du document.
- Si une information n'est pas présente dans le document ou pas assez claire, ne l'utilise pas.
- Les indices doivent être autonomes et compréhensibles une fois affichés.
- Le JSON peut être ajouté à un quiz contenant déjà des QCM classiques : il ne remplace pas les QCM, il ajoute seulement une compatibilité avec le mode Face-à-face.

Format de sortie :
Crée un fichier téléchargeable au format .json nommé compatibilite_qpuc.json.
Le contenu du fichier doit être uniquement un JSON valide, sans Markdown et sans bloc de code.
Si ton interface ne permet pas de joindre un fichier téléchargeable, retourne uniquement le JSON brut.

Structure exacte attendue :

{
  "mode": "qpuc_face_to_face",
  "question_count": 10,
  "questions": [
    {
      "id": 1,
      "theme": "Anatomie du membre supérieur",
      "answer": "Nerf médian",
      "accepted_answers": ["nerf médian", "médian"],
      "source_reference": "Section ou notion du document utilisée",
      "clues": [
        "Indice 1 difficile mais documenté",
        "Indice 2 un peu moins difficile",
        "Indice 3",
        "Indice 4",
        "Indice 5",
        "Indice 6",
        "Indice 7",
        "Indice 8 très parlant"
      ]
    }
  ]
}

Contrôle qualité silencieux avant réponse :
- le JSON est valide ;
- chaque question a une réponse courte ;
- chaque question a 8 à 10 indices ;
- les indices sont classés du moins évident au plus évident ;
- chaque indice apparaît explicitement ou découle directement du document ;
- aucune connaissance externe non fournie n'est utilisée.

Important :
Ne montre pas ton raisonnement interne.
Ne fournis que le fichier JSON téléchargeable.`;

export function QuizBuilder({
  initialQuiz,
  initialMetadataOptions,
  initialTags
}: {
  initialQuiz?: InitialQuizForBuilder;
  initialMetadataOptions: MetadataOptions;
  initialTags: string[];
}) {
  const router = useRouter();
  const isEditing = Boolean(initialQuiz);
  const [title, setTitle] = useState(initialQuiz?.title ?? "");
  const [questions, setQuestions] = useState<DraftQuestion[]>(() => toDraftQuestionsFromInitialQuiz(initialQuiz));
  const [selectedTags, setSelectedTags] = useState<string[]>(
    () => initialQuiz?.quizTags?.map((quizTag) => quizTag.tag.name) ?? []
  );
  const [customTag, setCustomTag] = useState("");
  const [sourceCity, setSourceCity] = useState(initialQuiz?.sourceCity ?? "");
  const [sourceYear, setSourceYear] = useState(initialQuiz?.sourceYear ?? "");
  const [trainingYear, setTrainingYear] = useState(initialQuiz?.trainingYear ?? "");
  const [showMoodleImport, setShowMoodleImport] = useState(false);
  const [moodleHtml, setMoodleHtml] = useState("");
  const [moodleImportError, setMoodleImportError] = useState<string | null>(null);
  const [showDocumentImport, setShowDocumentImport] = useState(false);
  const [documentJson, setDocumentJson] = useState("");
  const [documentImportError, setDocumentImportError] = useState<string | null>(null);
  const [documentImportMessage, setDocumentImportMessage] = useState<string | null>(null);
  const [documentPromptCopied, setDocumentPromptCopied] = useState(false);
  const [showQpucImport, setShowQpucImport] = useState(false);
  const [qpucJson, setQpucJson] = useState("");
  const [qpucQuestions, setQpucQuestions] = useState<DraftQpucQuestion[]>(
    () => parseInitialQpucQuestions(initialQuiz?.qpucQuestions)
  );
  const [qpucImportError, setQpucImportError] = useState<string | null>(null);
  const [qpucImportMessage, setQpucImportMessage] = useState<string | null>(null);
  const [qpucPromptCopied, setQpucPromptCopied] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableTags = useMemo(
    () => [...new Set([...initialTags, ...selectedTags].map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort(),
    [initialTags, selectedTags]
  );
  const availableCities = useMemo(
    () => uniqueMetadataOptions([...initialMetadataOptions.cities, sourceCity]),
    [initialMetadataOptions.cities, sourceCity]
  );
  const availableTrainingYears = useMemo(
    () => uniqueMetadataOptions([...initialMetadataOptions.trainingYears, trainingYear]),
    [initialMetadataOptions.trainingYears, trainingYear]
  );
  const academicYears = useMemo(
    () => uniqueAcademicYears([...generateAcademicYears(), ...initialMetadataOptions.sourceYears]),
    [initialMetadataOptions.sourceYears]
  );
  const lastQuestion = questions.at(-1);
  const canAddQuestion = !lastQuestion || validateQuestion(lastQuestion) === null;
  const hasUnessImport = questions.some((question) => question.importedFromMoodle);
  const isUnessQuiz = hasUnessImport || initialQuiz?.sourceType === "uness";
  const tagSuggestions = availableTags
    .filter((tag) => customTag.trim() && !selectedTags.includes(tag) && isSimilarTag(tag, customTag))
    .slice(0, 6);
  const citySuggestions = availableCities
    .filter((city) => sourceCity.trim() && city.toLowerCase() !== sourceCity.trim().toLowerCase() && isSimilarTag(city, sourceCity))
    .slice(0, 6);
  const trainingYearSuggestions = availableTrainingYears
    .filter(
      (year) =>
        trainingYear.trim() &&
        year.toLowerCase() !== trainingYear.trim().toLowerCase() &&
        isSimilarTag(year, trainingYear)
    )
    .slice(0, 6);

  function addQuestion(type: QuestionType) {
    setError(null);

    if (!canAddQuestion) {
      setError("Complète la question en cours avant d'en ajouter une nouvelle.");
      return;
    }

    setQuestions((previous) => [...previous, newQuestion(type)]);
  }

  function updateQuestion(id: string, patch: Partial<DraftQuestion>) {
    setQuestions((previous) =>
      previous.map((question) => (question.id === id ? { ...question, ...patch } : question))
    );
  }

  function updateOption(questionId: string, optionIndex: number, patch: Partial<DraftQuestion["options"][number]>) {
    setQuestions((previous) =>
      previous.map((question) =>
        question.id === questionId
          ? {
              ...question,
              options: question.options.map((option, index) =>
                index === optionIndex ? { ...option, ...patch } : option
              )
            }
          : question
      )
    );
  }

  function addOption(questionId: string) {
    setQuestions((previous) =>
      previous.map((question) =>
        question.id === questionId
          ? {
              ...question,
              options: [...question.options, { label: "", isCorrect: false, explanation: "" }]
            }
          : question
      )
    );
  }

  function removeOption(questionId: string, optionIndex: number) {
    setQuestions((previous) =>
      previous.map((question) =>
        question.id === questionId
          ? {
              ...question,
              options:
                question.options.length <= 2
                  ? question.options
                  : question.options.filter((_, index) => index !== optionIndex)
            }
          : question
      )
    );
  }

  function importMoodleHtml() {
    setError(null);
    setMoodleImportError(null);
    setImportMessage(null);

    if (!moodleHtml.trim()) {
      setMoodleImportError("Colle le bloc HTML Moodle avant d'importer.");
      return;
    }

    try {
      const extractedQuiz = extractQuizFromMoodleHtml(moodleHtml);
      const importedQuestions = extractedQuiz.questions
        .map(toDraftQuestionFromMoodle)
        .filter((question): question is DraftQuestion => question !== null);

      if (importedQuestions.length === 0) {
        setMoodleImportError("Le bloc sélectionné ne convient pas : aucune question exploitable n'a été trouvée.");
        return;
      }

      setQuestions((previous) => [...previous, ...importedQuestions]);
      setImportMessage(
        `${importedQuestions.length} question${importedQuestions.length > 1 ? "s" : ""} importée${
          importedQuestions.length > 1 ? "s" : ""
        }. Ajoute manuellement les images manquantes quand une question importée en contient une.`
      );
      setMoodleHtml("");
    } catch (importError) {
      setMoodleImportError(
        importError instanceof MoodleHtmlExtractionError
          ? importError.message
          : "Impossible de lire ce HTML. Vérifie que tu as bien copié le bloc <form> de la relecture Moodle."
      );
    }
  }

  function importDocumentJson() {
    setError(null);
    setDocumentImportError(null);
    setDocumentImportMessage(null);

    if (!documentJson.trim()) {
      setDocumentImportError("Dépose un fichier JSON ou colle son contenu avant d'importer.");
      return;
    }

    try {
      const extractedQuiz = extractQuizFromDocumentJson(documentJson);
      const importedQuestions = extractedQuiz.questions.map(toDraftQuestionFromDocumentJson);

      setQuestions((previous) => [...previous, ...importedQuestions]);
      setDocumentImportMessage(
        `${importedQuestions.length} question${importedQuestions.length > 1 ? "s" : ""} importée${
          importedQuestions.length > 1 ? "s" : ""
        } depuis le document.`
      );
      setDocumentJson("");
    } catch (importError) {
      setDocumentImportError(
        importError instanceof DocumentJsonExtractionError
          ? importError.message
          : "Impossible de lire ce JSON. Vérifie qu'il respecte la structure attendue."
      );
    }
  }

  function importQpucJson() {
    setError(null);
    setQpucImportError(null);
    setQpucImportMessage(null);

    if (!qpucJson.trim()) {
      setQpucImportError("Dépose un fichier JSON ou colle son contenu avant d'importer.");
      return;
    }

    try {
      const extractedQuiz = extractQpucQuestionsFromJson(qpucJson);
      const importedQuestions = extractedQuiz.questions.map(toDraftQpucQuestion);

      setQpucQuestions((previous) => [...previous, ...importedQuestions]);
      setQpucImportMessage(
        `${importedQuestions.length} question${importedQuestions.length > 1 ? "s" : ""} à indices progressifs importée${
          importedQuestions.length > 1 ? "s" : ""
        }.`
      );
      setQpucJson("");
    } catch (importError) {
      setQpucImportError(
        importError instanceof QpucJsonExtractionError
          ? importError.message
          : "Impossible de lire ce JSON. Vérifie qu'il respecte la structure attendue."
      );
    }
  }

  function toggleTag(tag: string) {
    setSelectedTags((previous) =>
      previous.includes(tag) ? previous.filter((selectedTag) => selectedTag !== tag) : [...previous, tag]
    );
  }

  function addCustomTag() {
    const tag = customTag.trim().toLowerCase();
    if (!tag) return;
    setSelectedTags((previous) => (previous.includes(tag) ? previous : [...previous, tag]));
    setCustomTag("");
  }

  async function attachImage(questionId: string, file: File) {
    setError(null);

    try {
      const imageDataUrl = await fileToValidatedImageDataUrl(file);
      updateQuestion(questionId, { imageUrl: imageDataUrl });
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "Image invalide.");
    }
  }

  async function attachDocumentJson(file: File) {
    setError(null);
    setDocumentImportError(null);
    setDocumentImportMessage(null);

    try {
      const json = await fileToValidatedTextJson(file);
      setDocumentJson(json);
    } catch (jsonError) {
      setDocumentImportError(jsonError instanceof Error ? jsonError.message : "Fichier JSON invalide.");
    }
  }

  async function attachQpucJson(file: File) {
    setError(null);
    setQpucImportError(null);
    setQpucImportMessage(null);

    try {
      const json = await fileToValidatedTextJson(file);
      setQpucJson(json);
    } catch (jsonError) {
      setQpucImportError(jsonError instanceof Error ? jsonError.message : "Fichier JSON invalide.");
    }
  }

  async function copyDocumentPrompt() {
    await navigator.clipboard.writeText(documentQuizPrompt);
    setDocumentPromptCopied(true);
    window.setTimeout(() => setDocumentPromptCopied(false), 1500);
  }

  async function copyQpucPrompt() {
    await navigator.clipboard.writeText(qpucCompatibilityPrompt);
    setQpucPromptCopied(true);
    window.setTimeout(() => setQpucPromptCopied(false), 1500);
  }

  async function submit() {
    setError(null);

    if (!title.trim()) {
      setError("Ajoute un titre au quiz.");
      return;
    }

    if (questions.length === 0 && qpucQuestions.length === 0) {
      setError("Ajoute au moins une question ou une compatibilité QPUC.");
      return;
    }

    if (isUnessQuiz) {
      if (!sourceCity.trim()) {
        setError("Renseigne la ville de l'annale UNESS.");
        return;
      }

      if (!sourceYear.trim()) {
        setError("Sélectionne l'année de l'annale UNESS.");
        return;
      }

      if (!trainingYear.trim()) {
        setError("Renseigne l'année de formation.");
        return;
      }
    }

    for (const [index, question] of questions.entries()) {
      const validationError = validateQuestion(question);
      if (validationError) {
        setError(`Question ${index + 1}: ${validationError}`);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(isEditing ? `${apiUrl}/quizzes/${initialQuiz?.id}` : `${apiUrl}/quizzes`, {
        method: isEditing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          tags: selectedTags,
          ...(isUnessQuiz
            ? {
                sourceType: "uness",
                sourceCity: sourceCity.trim(),
                sourceYear,
                trainingYear: trainingYear.trim()
              }
            : {}),
          questions: questions.map(toPayloadQuestion),
          qpucQuestions: qpucQuestions.map(toPayloadQpucQuestion)
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await response.json();
      router.push("/dashboard");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Impossible d'enregistrer le quiz.");
      setIsSubmitting(false);
    }
  }

  async function deleteCurrentQuiz() {
    if (!initialQuiz) return;

    const confirmed = window.confirm("Supprimer ce quiz et toutes ses données associées ?");

    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    const response = await fetch(`${apiUrl}/quizzes/${initialQuiz.id}`, { method: "DELETE" });

    if (!response.ok) {
      setError(await response.text());
      setIsSubmitting(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>{isEditing ? "Modifier le quiz" : "Nouveau quiz"}</h1>
          {isEditing ? (
            <button className="danger-button" disabled={isSubmitting} type="button" onClick={deleteCurrentQuiz}>
              Supprimer ce quiz
            </button>
          ) : null}
        </div>
        <label className="stack">
          Titre
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Titre du quiz" />
        </label>

        <section className="stack import-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2>Import UNESS / Moodle</h2>
              <p className="muted">Optionnel : crée automatiquement les questions depuis une page de relecture.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowMoodleImport((value) => !value)}>
              {showMoodleImport ? "Masquer" : "Importer"}
            </button>
          </div>

          {showMoodleImport ? (
            <div className="stack">
              <p className="muted">
                Ouvre l'annale UNESS, termine-la, passe en relecture, inspecte la page, copie le bloc HTML
                {" <form>"} complet, puis colle-le ici. Les images ne sont jamais importées : les questions concernées
                seront créées au format énoncé + image + réponses, et tu pourras ajouter les images manuellement.
              </p>
              <textarea
                value={moodleHtml}
                onChange={(event) => {
                  setMoodleHtml(event.target.value);
                  setMoodleImportError(null);
                }}
                placeholder="Colle ici le bloc <form> Moodle..."
                rows={8}
              />
              {moodleImportError ? <p className="inline-error" role="alert">{moodleImportError}</p> : null}
              <div className="row">
                <button type="button" onClick={importMoodleHtml}>
                  Importer les questions
                </button>
                <button className="secondary-button" type="button" onClick={() => setMoodleHtml("")}>
                  Vider
                </button>
              </div>
              {importMessage ? <p className="success-text">{importMessage}</p> : null}
            </div>
          ) : null}

          {showMoodleImport || isUnessQuiz ? (
            <div className="stack metadata-panel">
              <h3>Métadonnées UNESS</h3>
              <div className="grid">
                <label className="stack">
                  Ville de l'annale
                  <input
                    value={sourceCity}
                    onChange={(event) => setSourceCity(event.target.value)}
                    placeholder="Ex : Paris, Lyon, Nantes..."
                  />
                </label>
                <label className="stack">
                  Année
                  <select value={sourceYear} onChange={(event) => setSourceYear(event.target.value)}>
                    <option value="">Sélectionner une année</option>
                    {academicYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="stack">
                  Année de formation
                  <input
                    value={trainingYear}
                    onChange={(event) => setTrainingYear(event.target.value)}
                    placeholder="Ex : DFGSM3, DFASM1..."
                  />
                </label>
              </div>

              {citySuggestions.length > 0 ? (
                <div className="tag-list">
                  {citySuggestions.map((city) => (
                    <button className="tag-pill" key={city} type="button" onClick={() => setSourceCity(city)}>
                      {city}
                    </button>
                  ))}
                </div>
              ) : null}

              {trainingYearSuggestions.length > 0 ? (
                <div className="tag-list">
                  {trainingYearSuggestions.map((year) => (
                    <button className="tag-pill" key={year} type="button" onClick={() => setTrainingYear(year)}>
                      {year}
                    </button>
                  ))}
                </div>
              ) : null}

              {isUnessQuiz ? (
                <p className="muted">Ces champs sont obligatoires parce que des questions UNESS ont été importées.</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="stack import-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2>Importer un quizz à partir d'un document</h2>
              <p className="muted">Optionnel : dépose le JSON généré depuis un document de cours.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowDocumentImport((value) => !value)}>
              {showDocumentImport ? "Masquer" : "Importer"}
            </button>
          </div>

          {showDocumentImport ? (
            <div className="stack">
              <p className="muted">
                Fournis à l'IA le prompt ci-dessous et le document dont tu veux tirer un quiz. Récupère uniquement le
                fichier JSON téléchargeable généré, puis dépose-le ici. Chaque entrée sera transformée en QCM
                classique avec exactement 5 propositions.
              </p>
              <div className="row">
                <button className="secondary-button" type="button" onClick={copyDocumentPrompt}>
                  {documentPromptCopied ? "Prompt copié" : "Copier le prompt"}
                </button>
              </div>
              <div
                className="drop-zone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) void attachDocumentJson(file);
                }}
              >
                <p className="muted">Glisse le fichier JSON ici ou parcours ton système.</p>
                <label className="button file-button">
                  Parcourir
                  <input
                    accept="application/json,.json"
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void attachDocumentJson(file);
                    }}
                  />
                </label>
              </div>
              <textarea
                value={documentJson}
                onChange={(event) => {
                  setDocumentJson(event.target.value);
                  setDocumentImportError(null);
                }}
                placeholder="Ou colle ici le JSON généré depuis ton document..."
                rows={8}
              />
              {documentImportError ? <p className="inline-error" role="alert">{documentImportError}</p> : null}
              <div className="row">
                <button type="button" onClick={importDocumentJson}>
                  Importer les questions
                </button>
                <button className="secondary-button" type="button" onClick={() => setDocumentJson("")}>
                  Vider
                </button>
              </div>
              {documentImportMessage ? <p className="success-text">{documentImportMessage}</p> : null}
            </div>
          ) : null}
        </section>

        <section className="stack import-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2>Ajouter une compatibilité QPUC</h2>
              <p className="muted">Optionnel : importe des questions à indices progressifs pour le mode Face-à-face.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowQpucImport((value) => !value)}>
              {showQpucImport ? "Masquer" : "Ajouter"}
            </button>
          </div>

          {showQpucImport ? (
            <div className="stack">
              <p className="muted">
                Fournis à l'IA le prompt ci-dessous avec ton document de cours. Le JSON importé n'affichera pas les
                indices dans l'éditeur : il ajoute simplement une compatibilité avec le mode Face-à-face.
              </p>
              <div className="row">
                <button className="secondary-button" type="button" onClick={copyQpucPrompt}>
                  {qpucPromptCopied ? "Prompt copié" : "Copier le prompt"}
                </button>
              </div>
              <div
                className="drop-zone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) void attachQpucJson(file);
                }}
              >
                <p className="muted">Glisse le fichier JSON QPUC ici ou parcours ton système.</p>
                <label className="button file-button">
                  Parcourir
                  <input
                    accept="application/json,.json"
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void attachQpucJson(file);
                    }}
                  />
                </label>
              </div>
              <textarea
                value={qpucJson}
                onChange={(event) => {
                  setQpucJson(event.target.value);
                  setQpucImportError(null);
                }}
                placeholder="Ou colle ici le JSON de compatibilité QPUC..."
                rows={8}
              />
              {qpucImportError ? <p className="inline-error" role="alert">{qpucImportError}</p> : null}
              <div className="row">
                <button type="button" onClick={importQpucJson}>
                  Importer les indices
                </button>
                <button className="secondary-button" type="button" onClick={() => setQpucJson("")}>
                  Vider
                </button>
              </div>
              {qpucImportMessage ? <p className="success-text">{qpucImportMessage}</p> : null}
            </div>
          ) : null}

          {qpucQuestions.length > 0 ? (
            <div className="metadata-panel row" style={{ justifyContent: "space-between" }}>
              <p className="muted">
                {qpucQuestions.length} question{qpucQuestions.length > 1 ? "s" : ""} à indices progressifs importée
                {qpucQuestions.length > 1 ? "s" : ""}.
              </p>
              <button className="secondary-button" type="button" onClick={() => setQpucQuestions([])}>
                Retirer la compatibilité
              </button>
            </div>
          ) : null}
        </section>

        <div className="stack">
          <h2>Questions</h2>
        </div>

        {questions.length === 0 ? <p className="muted">Aucune question pour l'instant.</p> : null}

        {questions.map((question, questionIndex) => (
          <article className="card stack" key={question.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3>
                Question {questionIndex + 1} - {typeLabels[question.type]}
              </h3>
              <button
                type="button"
                onClick={() => setQuestions((previous) => previous.filter((item) => item.id !== question.id))}
              >
                Supprimer
              </button>
            </div>

            <label className="stack">
              Énoncé
              <input
                value={question.prompt}
                onChange={(event) => updateQuestion(question.id, { prompt: event.target.value })}
                placeholder="Énoncé de la question"
              />
            </label>

            {question.type === "image_multiple_choice" || question.type === "image_region" ? (
              <div
                className="drop-zone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) void attachImage(question.id, file);
                }}
              >
                {question.imageUrl ? (
                  <img className="question-image" src={question.imageUrl} alt="" />
                ) : (
                  <p className="muted">Glisse une image ici ou parcours ton système.</p>
                )}
                <label className="button file-button">
                  Parcourir
                  <input
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void attachImage(question.id, file);
                    }}
                  />
                </label>
              </div>
            ) : null}

            {question.type === "image_region" && question.imageUrl ? (
              <>
                <ImageRegionEditor
                  imageUrl={question.imageUrl}
                  regions={question.imageRegions}
                  onChange={(imageRegions) => updateQuestion(question.id, { imageRegions })}
                />
                <label className="stack">
                  Explication facultative
                  <textarea
                    value={question.imageRegionExplanation}
                    onChange={(event) => updateQuestion(question.id, { imageRegionExplanation: event.target.value })}
                    placeholder="Ex : il fallait pointer la lésion située au pôle supérieur..."
                    rows={3}
                  />
                </label>
              </>
            ) : null}

            {question.type === "open_text" ? (
              <label className="stack">
                Réponses acceptées
                <textarea
                  value={question.acceptedTextAnswers}
                  onChange={(event) => updateQuestion(question.id, { acceptedTextAnswers: event.target.value })}
                  placeholder="Une réponse acceptée par ligne"
                  rows={4}
                />
              </label>
            ) : question.type === "image_region" ? null : (
              <fieldset className="stack">
                <legend>{question.options.length} propositions</legend>
                {question.options.map((option, optionIndex) => (
                  <div className="option-editor-row" key={optionIndex}>
                    <div className="stack">
                      <input
                        value={option.label}
                        onChange={(event) => updateOption(question.id, optionIndex, { label: event.target.value })}
                        placeholder={`Proposition ${optionIndex + 1}`}
                      />
                      <input
                        value={option.explanation}
                        onChange={(event) => updateOption(question.id, optionIndex, { explanation: event.target.value })}
                        placeholder="Explication facultative"
                      />
                    </div>
                    <label className="checkbox-label">
                      <input
                        checked={option.isCorrect}
                        onChange={(event) => updateOption(question.id, optionIndex, { isCorrect: event.target.checked })}
                        type="checkbox"
                      />
                      Vraie
                    </label>
                    <button
                      className="secondary-button"
                      disabled={question.options.length <= 2}
                      type="button"
                      onClick={() => removeOption(question.id, optionIndex)}
                    >
                      Retirer
                    </button>
                  </div>
                ))}
                <button className="secondary-button" type="button" onClick={() => addOption(question.id)}>
                  Ajouter une proposition
                </button>
              </fieldset>
            )}

            {question.importedHadImage && !question.imageUrl ? (
              <p className="muted">Image détectée dans Moodle : ajoute l'image correspondante avant de créer le quiz.</p>
            ) : null}
            {question.importedCorrection?.correctAnswersText ? (
              <p className="muted">Correction Moodle : {question.importedCorrection.correctAnswersText}</p>
            ) : null}
            {question.importedCorrection?.generalExplanation ? (
              <p className="muted">Explication Moodle : {question.importedCorrection.generalExplanation}</p>
            ) : null}
            {question.importedDocumentMeta ? (
              <p className="muted">
                Import document : {question.importedDocumentMeta.difficulty} - {question.importedDocumentMeta.sourceTopic}
              </p>
            ) : null}

            {validateQuestion(question) ? <p role="alert">{validateQuestion(question)}</p> : null}
          </article>
        ))}

        <section className="stack question-add-panel">
          <h3>Ajouter une question</h3>
          <div className="row">
            {(Object.keys(typeLabels) as QuestionType[]).map((type) => (
              <button key={type} type="button" onClick={() => addQuestion(type)}>
                {typeLabels[type]}
              </button>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2>Tags</h2>
          <div className="tag-list">
            {availableTags.map((tag) => (
              <button
                className={selectedTags.includes(tag) ? "tag-pill tag-pill-selected" : "tag-pill"}
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
          <div className="row">
            <input
              value={customTag}
              onChange={(event) => setCustomTag(event.target.value)}
              placeholder="Nouveau tag"
            />
            <button type="button" onClick={addCustomTag}>
              Ajouter le tag
            </button>
          </div>
          {tagSuggestions.length > 0 ? (
            <div className="tag-list">
              {tagSuggestions.map((tag) => (
                <button
                  className="tag-pill"
                  key={tag}
                  type="button"
                  onClick={() => {
                    toggleTag(tag);
                    setCustomTag("");
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {error ? <p role="alert">{error}</p> : null}
        <button type="button" disabled={isSubmitting} onClick={submit}>
          {isSubmitting ? "Enregistrement..." : isEditing ? "Enregistrer les modifications" : "Créer le quiz"}
        </button>
      </section>
    </main>
  );
}

function newQuestion(type: QuestionType): DraftQuestion {
  return {
    id: crypto.randomUUID(),
    type,
    prompt: "",
    imageUrl: "",
    imageRegions: [],
    imageRegionExplanation: "",
    options: Array.from({ length: 5 }, () => ({ label: "", isCorrect: false, explanation: "" })),
    acceptedTextAnswers: ""
  };
}

function toDraftQuestionsFromInitialQuiz(initialQuiz?: InitialQuizForBuilder): DraftQuestion[] {
  return (initialQuiz?.questions ?? []).map((question) => ({
    id: crypto.randomUUID(),
    type: toDraftQuestionType(question.type),
    prompt: question.prompt,
    imageUrl: question.imageUrl ?? "",
    imageRegions: parseImageRegions(question.imageRegions),
    imageRegionExplanation: question.imageRegionExplanation ?? "",
    options:
      question.answerOptions?.map((option) => ({
        label: option.label,
        isCorrect: option.isCorrect,
        explanation: option.explanation ?? ""
      })) ?? Array.from({ length: 5 }, () => ({ label: "", isCorrect: false, explanation: "" })),
    acceptedTextAnswers: (question.acceptedTextAnswers ?? []).join("\n")
  }));
}

function toDraftQuestionType(type: PersistedQuestionType): QuestionType {
  switch (type) {
    case "IMAGE_MULTIPLE_CHOICE":
      return "image_multiple_choice";
    case "IMAGE_REGION":
      return "image_region";
    case "OPEN_TEXT":
      return "open_text";
    case "MULTIPLE_CHOICE":
    default:
      return "multiple_choice";
  }
}

function parseInitialQpucQuestions(value: unknown): DraftQpucQuestion[] {
  return parseQpucProgressiveQuestions(value).map((question) => ({
    id: question.id,
    theme: question.theme,
    answer: question.answer,
    acceptedAnswers: question.acceptedAnswers,
    clues: question.clues,
    sourceReference: question.sourceReference
  }));
}

function toDraftQuestionFromMoodle(question: ExtractedQuestion): DraftQuestion | null {
  const options = question.answers
    .map((answer) => ({
      label: answer.text,
      isCorrect: answer.isCorrect,
      explanation: answer.explanation ?? ""
    }))
    .filter((answer) => answer.label.trim());

  if (!question.statement.trim() || options.length < 2) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    type: question.hasImage ? "image_multiple_choice" : "multiple_choice",
    prompt: question.statement,
    imageUrl: "",
    imageRegions: [],
    imageRegionExplanation: "",
    options,
    acceptedTextAnswers: "",
    importedCorrection: question.correction,
    importedFromMoodle: true,
    importedHadImage: question.hasImage
  };
}

function toDraftQuestionFromDocumentJson(question: DocumentExtractedQuestion): DraftQuestion {
  return {
    id: crypto.randomUUID(),
    type: "multiple_choice",
    prompt: question.question,
    imageUrl: "",
    imageRegions: [],
    imageRegionExplanation: "",
    options: question.items.map((item) => ({
      label: item.text,
      isCorrect: item.isCorrect,
      explanation: item.explanation ?? ""
    })),
    acceptedTextAnswers: "",
    importedDocumentMeta: {
      difficulty: question.difficulty,
      sourceTopic: question.sourceTopic
    }
  };
}

function toDraftQpucQuestion(question: QpucExtractedQuestion): DraftQpucQuestion {
  return {
    id: crypto.randomUUID(),
    theme: question.theme,
    answer: question.answer,
    acceptedAnswers: question.acceptedAnswers,
    clues: question.clues,
    sourceReference: question.sourceReference
  };
}

function validateQuestion(question: DraftQuestion): string | null {
  if (!question.prompt.trim()) {
    return "l'énoncé est requis.";
  }

  if ((question.type === "image_multiple_choice" || question.type === "image_region") && !question.imageUrl.trim()) {
    return "une image est requise.";
  }

  if (question.type === "image_region") {
    return question.imageRegions.length > 0 ? null : "dessine au moins une zone correcte sur l'image.";
  }

  if (question.type === "open_text") {
    const answers = question.acceptedTextAnswers
      .split("\n")
      .map((answer) => answer.trim())
      .filter(Boolean);

    return answers.length > 0 ? null : "ajoute au moins une réponse acceptée.";
  }

  if (question.options.length < 2) {
    return "ajoute au moins deux propositions.";
  }

  if (question.options.some((option) => !option.label.trim())) {
    return "toutes les propositions doivent être remplies.";
  }

  if (!question.options.some((option) => option.isCorrect)) {
    return "sélectionne au moins une bonne réponse.";
  }

  return null;
}

async function fileToValidatedImageDataUrl(file: File): Promise<string> {
  const acceptedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  const maxBytes = 2_000_000;
  const maxDimension = 2400;

  if (!acceptedTypes.has(file.type)) {
    throw new Error("Format image non supporté. Utilise PNG, JPEG, WebP ou GIF.");
  }

  if (file.size > maxBytes) {
    throw new Error("Image trop lourde. Limite actuelle : 2 Mo.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  const dimensions = await readImageDimensions(dataUrl);

  if (dimensions.width > maxDimension || dimensions.height > maxDimension) {
    throw new Error("Résolution trop élevée. Limite actuelle : 2400 px par côté.");
  }

  return dataUrl;
}

async function fileToValidatedTextJson(file: File): Promise<string> {
  const maxBytes = 1_000_000;
  const isJsonFile = file.type === "application/json" || file.name.toLowerCase().endsWith(".json");

  if (!isJsonFile) {
    throw new Error("Format non supporté. Dépose un fichier .json.");
  }

  if (file.size > maxBytes) {
    throw new Error("Fichier JSON trop lourd. Limite actuelle : 1 Mo.");
  }

  return readFileAsText(file);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Impossible de lire le fichier image."));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Impossible de lire le fichier JSON."));
    reader.readAsText(file);
  });
}

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Image illisible."));
    image.src = dataUrl;
  });
}

function isSimilarTag(tag: string, input: string): boolean {
  const normalizedInput = input.trim().toLowerCase();

  if (!normalizedInput) {
    return false;
  }

  return tag.includes(normalizedInput) || levenshtein(tag, normalizedInput) <= 2;
}

function uniqueMetadataOptions(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
}

function uniqueAcademicYears(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (a, b) => getAcademicStartYear(b) - getAcademicStartYear(a)
  );
}

function getAcademicStartYear(value: string): number {
  const year = Number(value.match(/\d{4}/)?.[0] ?? 0);
  return Number.isFinite(year) ? year : 0;
}

function generateAcademicYears(): string[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 25 }, (_, index) => {
    const startYear = currentYear - index;
    return `${startYear}-${startYear + 1}`;
  });
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[a.length][b.length];
}

function toPayloadQuestion(question: DraftQuestion) {
  return {
    type: question.type,
    prompt: question.prompt.trim(),
    imageUrl: question.imageUrl.trim() || undefined,
    imageRegions: question.type === "image_region" ? question.imageRegions : [],
    imageRegionExplanation: question.type === "image_region" ? question.imageRegionExplanation.trim() : undefined,
    acceptedTextAnswers: question.acceptedTextAnswers
      .split("\n")
      .map((answer) => answer.trim())
      .filter(Boolean),
    options:
      question.type === "open_text"
        ? []
        : question.options.map((option) => ({
            label: option.label.trim(),
            isCorrect: option.isCorrect,
            explanation: option.explanation.trim()
          }))
  };
}

function toPayloadQpucQuestion(question: DraftQpucQuestion) {
  return {
    id: question.id,
    theme: question.theme,
    answer: question.answer,
    acceptedAnswers: question.acceptedAnswers,
    clues: question.clues,
    sourceReference: question.sourceReference
  };
}

function parseImageRegions(value: unknown): ImageRegionDto[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((region, index) => {
      if (!region || typeof region !== "object" || !Array.isArray((region as { points?: unknown }).points)) {
        return null;
      }

      const points = (region as { points: unknown[] }).points
        .map((point) => {
          if (!point || typeof point !== "object") {
            return null;
          }

          const x = Number((point as { x?: unknown }).x);
          const y = Number((point as { y?: unknown }).y);

          return Number.isFinite(x) && Number.isFinite(y) ? { x: clamp(x), y: clamp(y) } : null;
        })
        .filter((point): point is ImagePointDto => point !== null);

      return points.length >= 3
        ? {
            id: typeof (region as { id?: unknown }).id === "string" ? (region as { id: string }).id : `region-${index + 1}`,
            points
          }
        : null;
    })
    .filter((region): region is ImageRegionDto => region !== null);
}

function ImageRegionEditor({
  imageUrl,
  regions,
  onChange
}: {
  imageUrl: string;
  regions: ImageRegionDto[];
  onChange: (regions: ImageRegionDto[]) => void;
}) {
  const [draftPoints, setDraftPoints] = useState<ImagePointDto[]>([]);

  function pointFromEvent(event: PointerEvent<SVGSVGElement>): ImagePointDto {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height)
    };
  }

  function addPoint(nextPoint: ImagePointDto) {
    setDraftPoints((previous) => {
      const lastPoint = previous.at(-1);

      if (lastPoint && distance(lastPoint, nextPoint) < 0.006) {
        return previous;
      }

      return [...previous, nextPoint];
    });
  }

  return (
    <section className="stack region-editor">
      <div>
        <h4>Zones correctes</h4>
        <p className="muted">Trace une zone en maintenant le clic, puis relâche pour enregistrer la région.</p>
      </div>
      <div className="image-region-canvas">
        <img className="question-image" src={imageUrl} alt="" draggable={false} />
        <svg
          aria-label="Éditeur de régions sur image"
          className="image-region-overlay"
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 100 100"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraftPoints([pointFromEvent(event)]);
          }}
          onPointerMove={(event) => {
            if (draftPoints.length === 0) return;
            addPoint(pointFromEvent(event));
          }}
          onPointerUp={() => {
            setDraftPoints((previous) => {
              if (previous.length >= 3) {
                onChange([...regions, { id: crypto.randomUUID(), points: previous }]);
              }

              return [];
            });
          }}
        >
          {regions.map((region, index) => (
            <polygon className="image-region-polygon" key={region.id} points={toSvgPoints(region.points)}>
              <title>Région correcte {index + 1}</title>
            </polygon>
          ))}
          {draftPoints.length > 1 ? <polyline className="image-region-draft" points={toSvgPoints(draftPoints)} /> : null}
        </svg>
      </div>
      <div className="row">
        <span className="muted">
          {regions.length} région{regions.length > 1 ? "s" : ""} enregistrée{regions.length > 1 ? "s" : ""}
        </span>
        <button className="secondary-button" disabled={regions.length === 0} type="button" onClick={() => onChange(regions.slice(0, -1))}>
          Annuler la dernière zone
        </button>
        <button className="secondary-button" disabled={regions.length === 0} type="button" onClick={() => onChange([])}>
          Effacer les zones
        </button>
      </div>
    </section>
  );
}

function toSvgPoints(points: ImagePointDto[]): string {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function distance(first: ImagePointDto, second: ImagePointDto): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}
