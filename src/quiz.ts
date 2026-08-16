import { LLMProvider } from './llmProvider';

export type Question =
  | {
      type: 'mcq';
      question: string;
      options: string[];
      correctIndex: number;
      explanation: string;
    }
  | {
      type: 'short';
      question: string;
      /** What a correct free-text answer must cover; used by the LLM grader. */
      rubric: string;
    };

export interface QuizResult {
  /** True if the LLM judged the diff too trivial to meaningfully quiz on. */
  trivial: boolean;
  questions: Question[];
}

const SYSTEM_PROMPT = `You are a strict code-review examiner. You are given a git diff that a developer \
is about to commit. Some or all of this diff may have been written by an AI coding assistant. Your job \
is to write quiz questions that ONLY someone who actually read and understood the diff could answer \
correctly.

Rules for questions:
- Never ask about trivia that's answerable by pattern-matching syntax (e.g. "what is the function named").
- Ask about behavior, edge cases, why a change is safe or unsafe, what would break if a line were removed, \
control flow, or the consequences of the change.
- Wrong MCQ options must be plausible to someone who skimmed but didn't read carefully — no throwaway options.
- Ground questions in specific lines/hunks rather than generic questions about the diff as a whole.
- If the diff is trivial (only formatting, comments, a version bump, generated lockfiles, etc.), say so \
instead of inventing fake depth.

Output ONLY valid JSON, no prose, no markdown code fences, matching this TypeScript type:

type Question =
  | { type: "mcq"; question: string; options: string[]; correctIndex: number; explanation: string }
  | { type: "short"; question: string; rubric: string };

Return exactly: { "trivial": boolean, "questions": Question[] }

If "trivial" is true, "questions" may be an empty array.`;

export async function generateQuiz(
  diff: string,
  provider: LLMProvider,
  opts: { questionCount: number; allowShortAnswer: boolean }
): Promise<QuizResult> {
  const userPrompt = `Number of questions to generate: ${opts.questionCount}.
Free-text ("short") questions allowed: ${
    opts.allowShortAnswer
      ? 'yes — use a mix of "mcq" and "short" where a short answer is genuinely a better test of understanding'
      : 'no — use only "mcq" questions'
  }.

Here is the staged diff:

\`\`\`diff
${truncateDiff(diff)}
\`\`\`
`;

  const raw = await provider.complete(SYSTEM_PROMPT, userPrompt);
  const json = extractJson(raw);
  let parsed: QuizResult;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Could not parse quiz JSON from model output:\n${raw}`);
  }
  if (!parsed.questions) {
    parsed.questions = [];
  }
  return parsed;
}

export async function gradeShortAnswer(
  question: Extract<Question, { type: 'short' }>,
  diff: string,
  userAnswer: string,
  provider: LLMProvider
): Promise<{ correct: boolean; feedback: string }> {
  const system = `You are grading a developer's free-text answer to a code-review comprehension question \
about a git diff. Be strict but fair: the answer must demonstrate real understanding matching the rubric, \
not just confident-sounding text. Output ONLY JSON: { "correct": boolean, "feedback": string }. Feedback \
should be one short sentence.`;

  const user = `Diff:
\`\`\`diff
${truncateDiff(diff)}
\`\`\`

Question: ${question.question}
Rubric for a correct answer: ${question.rubric}
Developer's answer: ${userAnswer}`;

  const raw = await provider.complete(system, user);
  const json = extractJson(raw);
  try {
    return JSON.parse(json);
  } catch {
    return { correct: false, feedback: 'Could not automatically evaluate this answer.' };
  }
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1) return trimmed.slice(start, end + 1);
  return trimmed;
}

function truncateDiff(diff: string, maxChars = 24000): string {
  if (diff.length <= maxChars) return diff;
  return diff.slice(0, maxChars) + '\n\n[... diff truncated for length; consider committing in smaller chunks ...]';
}
