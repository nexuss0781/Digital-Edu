function initAssessment(containerId, questions, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (mode === 'quiz') {
        initQuizMode(container, questions, containerId);
    } else {
        initPagedMode(container, questions, mode, containerId);
    }
}

function initQuizMode(container, questions, containerId) {
    let currentIdx = 0;
    let answers = {};
    let feedbackShown = false;
    const total = questions.length;

    function render() {
        const q = questions[currentIdx];
        if (!q) { renderComplete(); return; }
        const answered = answers[currentIdx] !== undefined;
        const correct = answered && answers[currentIdx] === q.answer;
        const wrong = answered && !correct;

        let html = `<div style="margin-bottom:0.75rem;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
                <span style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);">Question ${currentIdx + 1} of ${total}</span>
                <span style="font-size:0.7rem;font-weight:600;color:var(--text-muted);">${Math.round(((currentIdx) / total) * 100)}% complete</span>
            </div>
            <div style="height:4px;background:var(--border);border-radius:9999px;overflow:hidden;margin-bottom:1.25rem;">
                <div style="height:100%;width:${((currentIdx) / total) * 100}%;background:linear-gradient(90deg,var(--c3),var(--c5));border-radius:9999px;transition:width 0.3s ease;"></div>
            </div>
        </div>`;

        html += `<div style="padding:1.5rem;border-radius:12px;border:2px solid ${answered ? (correct ? '#22c55e' : '#ef4444') : 'var(--border)'};background:var(--bg-card);margin-bottom:1rem;transition:all 0.3s ease;">
            <p style="font-size:0.95rem;font-weight:600;color:var(--text);margin-bottom:1rem;line-height:1.6;">${q.question}</p>
            <div style="display:flex;flex-direction:column;gap:0.5rem;">`;

        q.options.forEach((opt, oi) => {
            const letter = String.fromCharCode(65 + oi);
            const isSelected = answers[currentIdx] === letter;
            const isCorrectOption = letter === q.answer;
            let optStyle = 'display:flex;align-items:center;gap:0.625rem;padding:0.75rem 1rem;border-radius:10px;border:1.5px solid var(--border);cursor:pointer;transition:all 0.2s ease;font-size:0.875rem;';
            let inputAccent = 'accent-color:var(--c3);';

            if (answered) {
                if (isCorrectOption) {
                    optStyle += 'border-color:#22c55e;background:rgba(34,197,94,0.08);';
                } else if (isSelected && !correct) {
                    optStyle += 'border-color:#ef4444;background:rgba(239,68,68,0.08);';
                } else {
                    optStyle += 'opacity:0.5;';
                }
                inputAccent = isCorrectOption ? 'accent-color:#22c55e;' : (isSelected ? 'accent-color:#ef4444;' : '');
            }

            html += `<label style="${optStyle}" ${answered ? '' : 'onmouseover="this.style.borderColor=\'var(--c3)\';this.style.background=\'rgba(0,91,197,0.04)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'transparent\'"'}>
                <input type="radio" name="q_${currentIdx}" value="${letter}" ${isSelected ? 'checked' : ''} ${answered ? 'disabled' : ''}
                       onchange="answerQuizQuestion(${currentIdx}, '${letter}', '${containerId}')"
                       style="${inputAccent}width:16px;height:16px;flex-shrink:0;">
                <span style="font-weight:600;color:var(--text-muted);min-width:1.25rem;">${letter}</span>
                <span style="color:var(--text);">${opt}</span>
            </label>`;
        });

        html += `</div>`;

        if (wrong) {
            html += `<div style="margin-top:1rem;padding:1rem;border-radius:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);display:flex;align-items:flex-start;gap:0.625rem;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                <div>
                    <p style="font-size:0.85rem;font-weight:600;color:#ef4444;margin-bottom:0.25rem;">Not quite right</p>
                    <p style="font-size:0.8rem;color:var(--text-muted);">The correct answer is <strong style="color:var(--text);">${q.answer}</strong>. Review the material above and try the next question.</p>
                </div>
            </div>`;
        }

        if (correct) {
            html += `<div style="margin-top:1rem;padding:1rem;border-radius:10px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);display:flex;align-items:center;gap:0.625rem;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
                <p style="font-size:0.85rem;font-weight:600;color:#22c55e;">Correct! Well done.</p>
            </div>`;
        }

        html += `</div>`;

        if (answered) {
            const isLast = currentIdx >= total - 1;
            html += `<div style="display:flex;justify-content:${currentIdx > 0 ? 'space-between' : 'flex-end'};align-items:center;margin-top:1.25rem;">`;
            if (currentIdx > 0) {
                html += `<button onclick="quizPrev('${containerId}')" style="display:inline-flex;align-items:center;gap:0.375rem;padding:0.625rem 1.125rem;border-radius:10px;font-size:0.825rem;font-weight:600;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;transition:all 0.15s ease;font-family:inherit;" onmouseover="this.style.borderColor='var(--c3)';this.style.color='var(--c3)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text)'">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    Previous
                </button>`;
            }
            if (isLast) {
                html += `<button onclick="quizFinish('${containerId}')" style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.5rem;border-radius:10px;font-size:0.875rem;font-weight:700;border:none;background:linear-gradient(135deg,var(--c3),var(--c4));color:#E8F0FE;cursor:pointer;transition:all 0.2s ease;box-shadow:0 4px 16px rgba(0,91,197,0.3);font-family:inherit;" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 20px rgba(0,91,197,0.4)'" onmouseout="this.style.transform='';this.style.boxShadow='0 4px 16px rgba(0,91,197,0.3)'">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
                    Complete Quiz
                </button>`;
            } else {
                html += `<button onclick="quizNext('${containerId}')" style="display:inline-flex;align-items:center;gap:0.375rem;padding:0.625rem 1.125rem;border-radius:10px;font-size:0.825rem;font-weight:600;border:none;background:var(--c3);color:#E8F0FE;cursor:pointer;transition:all 0.15s ease;font-family:inherit;" onmouseover="this.style.background='var(--c4)'" onmouseout="this.style.background='var(--c3)'">
                    Next
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>`;
            }
            html += `</div>`;
        }

        container.innerHTML = html;
    }

    function renderComplete() {
        const correctCount = questions.filter((q, i) => answers[i] === q.answer).length;
        const pct = Math.round((correctCount / total) * 100);
        const passed = pct >= 60;

        let html = `<div style="text-align:center;padding:2rem 1rem;">
            <div style="width:64px;height:64px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:1rem;background:${passed ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'};">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${passed ? '#22c55e' : '#ef4444'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${passed ? '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>' : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'}</svg>
            </div>
            <h3 style="font-size:1.25rem;font-weight:700;color:var(--text);margin-bottom:0.5rem;">${passed ? 'Great Work!' : 'Keep Practicing'}</h3>
            <p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:0.25rem;">You answered <strong style="color:var(--text);">${correctCount} of ${total}</strong> questions correctly.</p>
            <p style="font-size:1.5rem;font-weight:800;color:${passed ? '#22c55e' : '#ef4444'};margin:0.75rem 0;">${pct}%</p>
            <div style="display:flex;justify-content:center;gap:0.75rem;margin-top:1.25rem;">
                <button onclick="quizRetry('${containerId}')" style="display:inline-flex;align-items:center;gap:0.375rem;padding:0.625rem 1.125rem;border-radius:10px;font-size:0.825rem;font-weight:600;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;transition:all 0.15s ease;font-family:inherit;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
                    Retry
                </button>
                <button onclick="quizNextContent('${containerId}')" style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.5rem;border-radius:10px;font-size:0.875rem;font-weight:700;border:none;background:linear-gradient(135deg,var(--c3),var(--c4));color:#E8F0FE;cursor:pointer;transition:all 0.2s ease;box-shadow:0 4px 16px rgba(0,91,197,0.3);font-family:inherit;">
                    Next Content
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
        </div>`;
        container.innerHTML = html;
    }

    window.answerQuizQuestion = function(idx, letter, cid) {
        answers[idx] = letter;
        feedbackShown = true;
        render();
    };

    window.quizNext = function(cid) {
        if (currentIdx < total - 1) {
            currentIdx++;
            feedbackShown = false;
            render();
        }
    };

    window.quizPrev = function(cid) {
        if (currentIdx > 0) {
            currentIdx--;
            feedbackShown = false;
            render();
        }
    };

    window.quizFinish = function(cid) {
        currentIdx = total;
        render();
    };

    window.quizRetry = function(cid) {
        currentIdx = 0;
        answers = {};
        feedbackShown = false;
        render();
    };

    window.quizNextContent = function(cid) {
        const el = document.getElementById(cid);
        if (el && el.dataset.nextContentId) {
            window.location.href = '/courses/' + el.dataset.nextContentId;
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    render();
}

function initPagedMode(container, questions, mode, containerId) {
    const perPage = mode === 'test' ? 5 : 10;
    let currentPage = 0;
    let answers = {};
    const totalQuestions = questions.length;
    const totalPages = Math.ceil(totalQuestions / perPage);

    function render() {
        const start = currentPage * perPage;
        const end = Math.min(start + perPage, totalQuestions);
        const pageQuestions = questions.slice(start, end);

        let html = `<div class="flex items-center justify-between mb-4">
            <span class="font-semibold" style="color:var(--primary-dark);">${mode.toUpperCase()}</span>
            <span style="color:var(--text-muted);">${start + 1}\u2013${end} of ${totalQuestions}</span>
        </div>`;

        pageQuestions.forEach((q, i) => {
            const idx = start + i;
            const answered = answers[idx] !== undefined;
            const correct = answers[idx] === q.answer;
            const borderColor = answered ? (correct ? 'var(--primary-mid)' : '#ef4444') : 'var(--border)';
            html += `<div class="p-3.5 mb-2.5 rounded-lg" style="border: 1px solid ${borderColor}; background: var(--bg);">
                <p class="font-medium mb-2 text-sm">${idx + 1}. ${q.question}</p>
                <div class="space-y-1">`;
            q.options.forEach((opt, oi) => {
                const letter = String.fromCharCode(65 + oi);
                const checked = answers[idx] === letter ? 'checked' : '';
                const disabled = answered ? 'disabled' : '';
                html += `<label class="flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : 'cursor-pointer'}">
                    <input type="radio" name="q_${idx}" value="${letter}" ${checked} ${disabled}
                           onchange="answerQuestion(${idx}, '${letter}', '${containerId}')"
                           style="accent-color: var(--primary-dark);">
                    ${letter}. ${opt}
                </label>`;
            });
            html += `</div>`;
            if (answered) {
                html += `<p class="text-xs mt-1.5 font-medium" style="color: ${correct ? 'var(--primary-mid)' : '#ef4444'};">
                    ${correct ? '\u2713 Correct' : '\u2717 Incorrect \u2014 Answer: ' + q.answer}
                </p>`;
            }
            html += `</div>`;
        });

        if (totalPages > 1) {
            html += `<div class="flex justify-between mt-4">
                <button onclick="navigatePage(-1, '${containerId}')" ${currentPage === 0 ? 'disabled' : ''}
                        class="px-4 py-1.5 rounded text-sm text-white" style="background:var(--primary-dark); ${currentPage === 0 ? 'opacity-50' : ''}">Previous</button>
                <span style="color:var(--text-muted);">Page ${currentPage + 1} of ${totalPages}</span>
                <button onclick="navigatePage(1, '${containerId}')" ${currentPage >= totalPages - 1 ? 'disabled' : ''}
                        class="px-4 py-1.5 rounded text-sm text-white" style="background:var(--primary-dark); ${currentPage >= totalPages - 1 ? 'opacity-50' : ''}">Next</button>
            </div>`;
        }

        if (Object.keys(answers).length === totalQuestions) {
            const correctCount = questions.filter((q, i) => answers[i] === q.answer).length;
            const errorCount = totalQuestions - correctCount;
            const minErrors = container.dataset.minErrors ? parseInt(container.dataset.minErrors) : null;
            let passed;
            let resultText;
            if (minErrors !== null && !isNaN(minErrors)) {
                passed = errorCount <= minErrors;
                resultText = `${correctCount}/${totalQuestions} (${errorCount} errors) \u2014 max ${minErrors} errors allowed \u2014 ${passed ? 'PASSED' : 'FAILED'}`;
            } else {
                const threshold = container.dataset.threshold ? parseInt(container.dataset.threshold) : 50;
                const pct = Math.round(correctCount / totalQuestions * 100);
                passed = pct >= threshold;
                resultText = `${correctCount}/${totalQuestions} (${pct}%) \u2014 ${passed ? 'PASSED' : 'FAILED'}`;
            }
            html += `<div class="mt-4 p-4 rounded text-center font-semibold" style="background: ${passed ? 'rgba(0,180,252,0.12)' : 'rgba(239,68,68,0.1)'}; color: ${passed ? 'var(--primary-mid)' : '#ef4444'};">
                Result: ${resultText}
            </div>`;
        }

        container.innerHTML = html;
    }

    window.answerQuestion = function(idx, letter, cid) {
        answers[idx] = letter;
        render();
    };

    window.navigatePage = function(delta, cid) {
        currentPage += delta;
        render();
    };

    render();
}


// ---------------------------------------------------------------------------
// Workshop — Monaco editor + server-side validation
// ---------------------------------------------------------------------------

function initWorkshop(containerId, steps, contentId) {
    let currentStep = 0;
    const container = document.getElementById(containerId);
    if (!container) return;

    const editorEl = document.getElementById(containerId + '-editor');
    const submitBtn = container.querySelector('.workshop-submit');
    const feedback = container.querySelector('.workshop-feedback');
    const progress = container.querySelector('.workshop-progress');
    const stepDisplay = container.querySelector('.workshop-step');
    const progressText = container.querySelector('.workshop-progress-text');

    const monaco = window.monaco;
    const editor = monaco.editor.create(editorEl, {
        value: '',
        language: 'html',
        theme: document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs',
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
    });

    // Sync theme changes
    const observer = new MutationObserver(() => {
        const isDark = document.documentElement.classList.contains('dark');
        monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    async function saveStep(step) {
        try {
            await fetch(`/api/progress/${contentId}/step`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({step_index: step, code: editor.getValue()}),
            });
        } catch {}
    }

    async function completeWorkshop() {
        try {
            await fetch(`/api/progress/${contentId}/complete`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({content_type: 'workshop', completed: true}),
            });
        } catch {}
    }

    async function loadProgress() {
        try {
            const res = await fetch(`/api/progress/${contentId}`);
            const data = await res.json();
            if (data.step_index > 0) currentStep = data.step_index;
            if (data.code) editor.setValue(data.code);
        } catch {}
    }

    function renderStep() {
        const step = steps[currentStep];
        if (!step) {
            stepDisplay.innerHTML = '<div class="text-center py-8"><h3 class="text-xl font-bold" style="color:var(--accent);">Workshop Complete!</h3></div>';
            editorEl.style.display = 'none';
            if (submitBtn) submitBtn.style.display = 'none';
            return;
        }
        stepDisplay.innerHTML = `
            <h3 class="text-lg font-bold mb-2" style="color:var(--primary-dark);">Step ${currentStep + 1} of ${steps.length}</h3>
            <p class="mb-3">${step.explanation}</p>
            <p class="text-sm font-mono mb-2" style="color:var(--text-muted);">${step.prompt}</p>
        `;
        const pct = Math.round((currentStep / steps.length) * 100);
        if (progress) progress.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `${pct}%`;
        if (feedback) feedback.innerHTML = '';
        editor.focus();
    }

    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            const step = steps[currentStep];
            if (!step) return;

            const code = editor.getValue();
            const rule = step.validate || null;

            // If step has a validate rule, use server-side validation
            if (rule) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Checking...';
                try {
                    const res = await fetch('/api/validate', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ rule, code }),
                    });
                    const result = await res.json();
                    if (result.passed) {
                        feedback.innerHTML = '<p class="text-green-600">\u2713 Correct! Moving to next step...</p>';
                        currentStep++;
                        await saveStep(currentStep);
                        if (currentStep >= steps.length) {
                            await completeWorkshop();
                        }
                        setTimeout(renderStep, 800);
                    } else {
                        feedback.innerHTML = `<p class="text-red-500">\u2717 ${result.hint || 'Not quite. Check the requirements and try again.'}</p>`;
                    }
                } catch (e) {
                    feedback.innerHTML = '<p class="text-red-500">\u2717 Validation error. Please try again.</p>';
                }
                submitBtn.disabled = false;
                submitBtn.textContent = 'Check Step';
            } else if (step.expected) {
                // Legacy exact match fallback
                if (code.trim() === step.expected.trim()) {
                    feedback.innerHTML = '<p class="text-green-600">\u2713 Correct! Moving to next step...</p>';
                    currentStep++;
                    await saveStep(currentStep);
                    if (currentStep >= steps.length) {
                        await completeWorkshop();
                    }
                    setTimeout(renderStep, 800);
                } else {
                    feedback.innerHTML = '<p class="text-red-500">\u2717 Incorrect. Please try again.</p>';
                }
            }
        });
    }

    loadProgress().then(renderStep);
}


// ---------------------------------------------------------------------------
// Practical Workshop — Monaco editor + server-side validation
// ---------------------------------------------------------------------------

function initPracticalWorkshop(containerId, requirements, contentId, goal) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const editorEl = document.getElementById(containerId + '-editor');
    const monaco = window.monaco;

    const editor = monaco.editor.create(editorEl, {
        value: '',
        language: 'html',
        theme: document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs',
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
    });

    // Sync theme changes
    const observer = new MutationObserver(() => {
        const isDark = document.documentElement.classList.contains('dark');
        monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const passedReqs = new Set();

    function getCode() {
        return editor.getValue();
    }

    async function saveCode() {
        try {
            await fetch(`/api/progress/${contentId}/step`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ step_index: 0, code: getCode() }),
            });
        } catch {}
    }

    async function completePractical() {
        try {
            await fetch(`/api/progress/${contentId}/complete`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ content_type: 'practical', completed: true }),
            });
        } catch {}
    }

    async function loadProgress() {
        try {
            const res = await fetch(`/api/progress/${contentId}`);
            const data = await res.json();
            if (data.code) editor.setValue(data.code);
        } catch {}
    }

    function clearAllHints() {
        requirements.forEach((_, index) => {
            const hintEl = container.querySelector(`.req-hint-${index}`);
            if (hintEl) { hintEl.style.display = 'none'; hintEl.textContent = ''; }
        });
    }

    function checkAutoComplete() {
        if (passedReqs.size === requirements.length) {
            completePractical();
            const card = container.querySelector('.card');
            if (card) {
                const badge = document.createElement('div');
                badge.className = 'mt-3 p-3 rounded-lg text-center text-sm font-semibold';
                badge.style.cssText = 'background: rgba(34,197,94,0.1); color: #22c55e; border: 1px solid rgba(34,197,94,0.3);';
                badge.textContent = 'All requirements met! Practical complete.';
                card.appendChild(badge);
            }
        }
    }

    // Clear hints when code changes
    editor.onDidChangeModelContent(() => {
        clearAllHints();
        // Reset status icons for non-passed requirements
        requirements.forEach((_, index) => {
            if (!passedReqs.has(index)) {
                const statusEl = container.querySelector(`.req-status-${index}`);
                if (statusEl) {
                    statusEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
                }
                const checkBtn = container.querySelector(`.check-req-${index}`);
                if (checkBtn) { checkBtn.disabled = false; checkBtn.style.opacity = '1'; }
            }
        });
    });

    // Per-requirement check buttons
    requirements.forEach((req, index) => {
        const checkBtn = container.querySelector(`.check-req-${index}`);
        const statusEl = container.querySelector(`.req-status-${index}`);
        const hintEl = container.querySelector(`.req-hint-${index}`);
        if (checkBtn) {
            checkBtn.addEventListener('click', async () => {
                const code = getCode();
                const rule = req.validate || null;

                checkBtn.disabled = true;
                checkBtn.textContent = '...';

                try {
                    let passed = false;
                    let hint = '';

                    if (rule && !rule.startsWith('code.')) {
                        const res = await fetch('/api/validate', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ rule, code }),
                        });
                        const result = await res.json();
                        passed = result.passed;
                        hint = result.hint;
                    } else {
                        passed = safeValidate(code, rule || 'false');
                    }

                    if (passed) {
                        statusEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>';
                        if (hintEl) { hintEl.style.display = 'none'; hintEl.textContent = ''; }
                        checkBtn.style.opacity = '0.5';
                        passedReqs.add(index);
                        saveCode();
                        checkAutoComplete();
                    } else {
                        statusEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';
                        if (hintEl && hint) {
                            hintEl.textContent = hint;
                            hintEl.style.display = 'block';
                        } else if (hintEl) {
                            hintEl.style.display = 'none';
                        }
                    }
                } catch {
                    statusEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';
                }

                checkBtn.disabled = false;
                checkBtn.textContent = 'Check';
            });
        }
    });

    // Live preview
    const liveBtn = container.querySelector('.live-view-btn');
    const goalBtn = container.querySelector('.goal-view-btn');
    const frame = container.querySelector('.preview-frame');
    if (liveBtn && frame) {
        liveBtn.addEventListener('click', () => {
            frame.srcdoc = getCode();
        });
    }

    // Goal toggle
    if (goalBtn && frame) {
        let showingGoal = false;
        goalBtn.addEventListener('click', () => {
            showingGoal = !showingGoal;
            if (showingGoal) {
                frame.srcdoc = goal || '<p style="padding:1rem;color:#666;">No goal preview available.</p>';
                goalBtn.textContent = 'Code';
            } else {
                frame.srcdoc = getCode();
                goalBtn.textContent = 'Goal';
            }
        });
    }

    loadProgress();
}


// ---------------------------------------------------------------------------
// Legacy client-side validator (for code.includes() / code.match() expressions)
// ---------------------------------------------------------------------------

function safeValidate(code, expr) {
    if (!expr) return false;
    const includesMatch = expr.match(/^code\.includes\(['"](.+?)['"]\)$/);
    if (includesMatch) {
        return code.includes(includesMatch[1]);
    }
    const matchMatch = expr.match(/^code\.match\(\/(.+)\/([gim]*)\)$/);
    if (matchMatch) {
        return new RegExp(matchMatch[1], matchMatch[2]).test(code);
    }
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    return false;
}
