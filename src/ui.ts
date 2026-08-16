import * as vscode from 'vscode';
import { Question, gradeShortAnswer } from './quiz';
import { LLMProvider } from './llmProvider';
import { getConfig } from './config';

export interface QuizRunResult {
  total: number;
  correct: number;
  details: { question: string; correct: boolean; feedback?: string }[];
  /** True if the user closed the panel before finishing a question. */
  aborted: boolean;
}

/**
 * Runs the quiz in a themed Webview panel (rather than QuickPick/InputBox),
 * driven by a simple message protocol: the extension owns all state and
 * pushes { showQuestion | grading | feedback | finish } messages; the panel
 * pushes back { submit | next | close }.
 */
export async function runQuizUI(
  questionsPromise: Question[] | Promise<Question[]>,
  diff: string,
  provider: LLMProvider
): Promise<QuizRunResult> {
  const panel = vscode.window.createWebviewPanel(
    'aiditorQuiz',
    'AIditor: Review Your Changes',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const nonce = getNonce();
  panel.webview.html = getHtml(nonce);

  const details: QuizRunResult['details'] = [];
  let correctCount = 0;
  let disposed = false;
  let resolveWait: ((msg: any) => void) | null = null;

  const disposeListener = panel.onDidDispose(() => {
    disposed = true;
    if (resolveWait) {
      const r = resolveWait;
      resolveWait = null;
      r({ type: '__disposed__' });
    }
  });

  const messageListener = panel.webview.onDidReceiveMessage((msg) => {
    if (resolveWait) {
      const r = resolveWait;
      resolveWait = null;
      r(msg);
    }
  });

  function waitForMessage(): Promise<any> {
    return new Promise((resolve) => {
      if (disposed) {
        resolve({ type: '__disposed__' });
        return;
      }
      resolveWait = resolve;
    });
  }

  function post(msg: any) {
    if (!disposed) {
      panel.webview.postMessage(msg);
    }
  }

  try {
    // Show the loading state immediately while questions are being generated
    post({ type: 'loading' });

    let questions: Question[];
    try {
      questions = await questionsPromise;
    } catch (err: any) {
      if (disposed) {
        return { total: 0, correct: 0, details: [], aborted: true };
      }
      throw err;
    }

    if (disposed) {
      return { total: questions.length, correct: 0, details: [], aborted: true };
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];

      post({
        type: 'showQuestion',
        index: i,
        total: questions.length,
        question:
          q.type === 'mcq'
            ? { type: 'mcq', question: q.question, options: q.options }
            : { type: 'short', question: q.question },
      });

      const submitMsg = await waitForMessage();
      if (submitMsg.type === '__disposed__') {
        return { total: questions.length, correct: correctCount, details, aborted: true };
      }

      let isCorrect = false;
      let feedback = '';

      if (q.type === 'mcq') {
        isCorrect = submitMsg.value === q.correctIndex;
        feedback = q.explanation;
      } else {
        post({ type: 'grading' });
        const graded = await gradeShortAnswer(q, diff, submitMsg.value ?? '', provider);
        isCorrect = graded.correct;
        feedback = graded.feedback;
      }

      if (isCorrect) correctCount++;
      details.push({ question: q.question, correct: isCorrect, feedback });

      post({
        type: 'feedback',
        correct: isCorrect,
        feedback,
        correctIndex: q.type === 'mcq' ? q.correctIndex : undefined,
        isLast: i === questions.length - 1,
      });

      const nextMsg = await waitForMessage();
      if (nextMsg.type === '__disposed__') {
        return { total: questions.length, correct: correctCount, details, aborted: true };
      }
    }

    if (questions.length === 0) {
      return { total: 0, correct: 0, details: [], aborted: false };
    }

    const fraction = questions.length === 0 ? 1 : correctCount / questions.length;
    const passed = fraction >= getConfig().passThreshold;

    post({ type: 'finish', correct: correctCount, total: questions.length, passed });

    // Whether they click "Done" or just close the tab, the quiz itself is
    // already complete at this point, so this always counts as finished.
    await waitForMessage();
    return { total: questions.length, correct: correctCount, details, aborted: false };
  } finally {
    disposeListener.dispose();
    messageListener.dispose();
    if (!disposed) {
      panel.dispose();
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getHtml(nonce: string): string {
  return (
    '<!DOCTYPE html>' +
    '<html lang="en">' +
    '<head>' +
    '<meta charset="UTF-8" />' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'nonce-' +
    nonce +
    '\'; script-src \'nonce-' +
    nonce +
    '\';">' +
    '<title>AIditor Review</title>' +
    '<style nonce="' + nonce + '">' + CSS + '</style>' +
    '</head>' +
    '<body>' +
    '<div class="card" id="app"></div>' +
    '<script nonce="' + nonce + '">' + SCRIPT + '</script>' +
    '</body>' +
    '</html>'
  );
}

const CSS = `
:root {
  --pass-color: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #2ea043));
  --fail-color: var(--vscode-testing-iconFailed, var(--vscode-charts-red, #f14c4c));
  --hairline: var(--vscode-widget-border, rgba(128, 128, 128, 0.3));
}
* { box-sizing: border-box; }
html, body {
  height: 100%;
  margin: 0;
  padding: 0;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: var(--vscode-font-family);
  font-size: 13px;
}
body { display: flex; justify-content: center; padding: 40px 24px; }
.card { width: 100%; max-width: 560px; }

.eyebrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 24px;
}
.dots { display: flex; gap: 6px; flex-shrink: 0; }
.dot {
  width: 18px;
  height: 4px;
  border-radius: 2px;
  background: var(--hairline);
  transition: background 0.2s ease;
}
.dot.current { background: var(--vscode-focusBorder); }
.dot.correct { background: var(--pass-color); }
.dot.incorrect { background: var(--fail-color); }

h1 { font-size: 16px; font-weight: 600; line-height: 1.55; margin: 0 0 24px 0; }

.options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.option {
  text-align: left;
  padding: 12px 14px;
  border: 1px solid var(--hairline);
  border-left: 3px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-editor-foreground);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.option:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
.option:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.option.selected { border-left-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
.option:disabled { cursor: default; }
.option.correct-answer { border-left-color: var(--pass-color); background: var(--vscode-list-hoverBackground); }
.option.wrong-answer { border-left-color: var(--fail-color); background: var(--vscode-list-hoverBackground); }

textarea {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  padding: 10px 12px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--hairline));
  border-radius: 4px;
  font-family: inherit;
  font-size: 13px;
  margin-bottom: 20px;
}
textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

.actions { display: flex; justify-content: flex-end; }
button.primary {
  padding: 6px 16px;
  border: none;
  border-radius: 3px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}
button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button.primary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
button.primary:disabled { opacity: 0.5; cursor: default; }

.grading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vscode-descriptionForeground);
  margin: 4px 0 20px 0;
}
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--vscode-descriptionForeground);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.feedback {
  border-left: 3px solid var(--vscode-focusBorder);
  padding: 12px 14px;
  margin-bottom: 20px;
  background: var(--vscode-list-hoverBackground);
  border-radius: 0 4px 4px 0;
}
.feedback .verdict {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vscode-focusBorder);
  margin-bottom: 6px;
}
.feedback p { margin: 0; line-height: 1.6; }
.feedback.pass { border-left-color: var(--pass-color); }
.feedback.pass .verdict { color: var(--pass-color); }
.feedback.fail { border-left-color: var(--fail-color); }
.feedback.fail .verdict { color: var(--fail-color); }

.finish { text-align: center; padding-top: 24px; }
.finish .score {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 40px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--vscode-editor-foreground);
}
.finish .verdict-label {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 20px;
}
.finish p.msg { color: var(--vscode-descriptionForeground); line-height: 1.6; margin: 0 0 28px 0; }
.finish.pass .score, .finish.pass .verdict-label { color: var(--pass-color); }
.finish.fail .score, .finish.fail .verdict-label { color: var(--fail-color); }
.finish .actions { justify-content: center; }

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
}
.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--hairline);
  border-top-color: var(--vscode-focusBorder);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 20px;
}
.loading-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-editor-foreground);
  margin-bottom: 6px;
}
.loading-sub {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

@media (prefers-reduced-motion: reduce) {
  .spinner, .loading-spinner { animation: none; }
  .dot, .option, button.primary { transition: none; }
}
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const app = document.getElementById('app');

let currentQuestion = null;
let currentIndex = 0;
let selectedOption = null;
let dotsState = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderDots(total, index, state) {
  let html = '<div class="dots">';
  for (let i = 0; i < total; i++) {
    let cls = 'dot';
    if (state[i] === 'correct') cls += ' correct';
    else if (state[i] === 'incorrect') cls += ' incorrect';
    else if (i === index) cls += ' current';
    html += '<span class="' + cls + '"></span>';
  }
  html += '</div>';
  return html;
}

window.addEventListener('message', (event) => {
  const msg = event.data;

  if (msg.type === 'loading') {
    app.innerHTML =
      '<div class="loading-container">' +
      '<div class="loading-spinner"></div>' +
      '<div class="loading-text">Generating review questions\u2026</div>' +
      '<div class="loading-sub">Analyzing your staged changes</div>' +
      '</div>';
  }

  if (msg.type === 'showQuestion') {
    currentQuestion = msg.question;
    currentIndex = msg.index;
    selectedOption = null;
    if (dotsState.length === 0) dotsState = new Array(msg.total).fill('pending');

    let body = '';
    if (msg.question.type === 'mcq') {
      body =
        '<div class="options">' +
        msg.question.options
          .map((opt, i) => '<button class="option" data-idx="' + i + '">' + escapeHtml(opt) + '</button>')
          .join('') +
        '</div>' +
        '<div class="actions"><button class="primary" id="submitBtn" disabled>Submit Answer</button></div>';
    } else {
      body =
        '<textarea id="shortAnswer" placeholder="Answer in your own words\u2026"></textarea>' +
        '<div class="actions"><button class="primary" id="submitBtn" disabled>Submit Answer</button></div>';
    }

    app.innerHTML =
      '<div class="eyebrow">' +
      '<span>AIditor review \u00b7 Q' + (msg.index + 1) + ' of ' + msg.total + '</span>' +
      renderDots(msg.total, msg.index, dotsState) +
      '</div>' +
      '<h1>' + escapeHtml(msg.question.question) + '</h1>' +
      body;

    if (msg.question.type === 'mcq') {
      const optionEls = Array.from(app.querySelectorAll('.option'));
      optionEls.forEach((el) => {
        el.addEventListener('click', () => {
          optionEls.forEach((e) => e.classList.remove('selected'));
          el.classList.add('selected');
          selectedOption = parseInt(el.getAttribute('data-idx'), 10);
          document.getElementById('submitBtn').disabled = false;
        });
      });
      document.getElementById('submitBtn').addEventListener('click', () => {
        optionEls.forEach((e) => (e.disabled = true));
        document.getElementById('submitBtn').disabled = true;
        vscode.postMessage({ type: 'submit', value: selectedOption });
      });
    } else {
      const textarea = document.getElementById('shortAnswer');
      const submitBtn = document.getElementById('submitBtn');
      textarea.addEventListener('input', () => {
        submitBtn.disabled = textarea.value.trim().length === 0;
      });
      submitBtn.addEventListener('click', () => {
        textarea.disabled = true;
        submitBtn.disabled = true;
        vscode.postMessage({ type: 'submit', value: textarea.value });
      });
    }
  }

  if (msg.type === 'grading') {
    app.insertAdjacentHTML(
      'beforeend',
      '<div class="grading"><span class="spinner"></span><span>Grading your answer\u2026</span></div>'
    );
  }

  if (msg.type === 'feedback') {
    dotsState[currentIndex] = msg.correct ? 'correct' : 'incorrect';
    const dotsContainer = app.querySelector('.dots');
    if (dotsContainer) {
      dotsContainer.outerHTML = renderDots(dotsState.length, currentIndex, dotsState);
    }

    const gradingEl = app.querySelector('.grading');
    if (gradingEl) gradingEl.remove();

    if (currentQuestion.type === 'mcq') {
      const optionEls = Array.from(app.querySelectorAll('.option'));
      optionEls.forEach((el, i) => {
        el.classList.remove('selected');
        if (i === msg.correctIndex) el.classList.add('correct-answer');
        else if (i === selectedOption) el.classList.add('wrong-answer');
      });
    }

    const existingActions = app.querySelector('.actions');
    if (existingActions) existingActions.remove();

    app.insertAdjacentHTML(
      'beforeend',
      '<div class="feedback ' + (msg.correct ? 'pass' : 'fail') + '">' +
        '<div class="verdict">' + (msg.correct ? 'Correct' : 'Not quite') + '</div>' +
        '<p>' + escapeHtml(msg.feedback) + '</p>' +
        '</div>' +
        '<div class="actions"><button class="primary" id="nextBtn">' +
        (msg.isLast ? 'See Results' : 'Next Question') +
        '</button></div>'
    );
    document.getElementById('nextBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'next' });
    });
  }

  if (msg.type === 'finish') {
    const verdict = msg.passed ? 'Passed' : 'Below threshold';
    const message = msg.passed
      ? 'Solid \u2014 you can go ahead and commit.'
      : 'Give the diff another look before committing.';

    app.innerHTML =
      '<div class="finish ' + (msg.passed ? 'pass' : 'fail') + '">' +
      '<div class="score">' + msg.correct + '/' + msg.total + '</div>' +
      '<div class="verdict-label">' + verdict + '</div>' +
      '<p class="msg">' + escapeHtml(message) + '</p>' +
      '<div class="actions"><button class="primary" id="doneBtn">Done</button></div>' +
      '</div>';

    document.getElementById('doneBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'close' });
    });
  }
});
`;
