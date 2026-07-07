function initAssessment(containerId, questions, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const perPage = mode === 'quiz' ? 1 : mode === 'test' ? 5 : 10;
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

        if (mode !== 'quiz' && totalPages > 1) {
            html += `<div class="flex justify-between mt-4">
                <button onclick="navigatePage(-1, '${containerId}')" ${currentPage === 0 ? 'disabled' : ''}
                        class="px-4 py-1.5 rounded text-sm text-white" style="background:var(--primary-dark); ${currentPage === 0 ? 'opacity-50' : ''}">Previous</button>
                <span style="color:var(--text-muted);">Page ${currentPage + 1} of ${totalPages}</span>
                <button onclick="navigatePage(1, '${containerId}')" ${currentPage >= totalPages - 1 ? 'disabled' : ''}
                        class="px-4 py-1.5 rounded text-sm text-white" style="background:var(--primary-dark); ${currentPage >= totalPages - 1 ? 'opacity-50' : ''}">Next</button>
            </div>`;
        }

        if (mode !== 'quiz' && Object.keys(answers).length === totalQuestions) {
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
        const c = document.getElementById(cid);
        answers[idx] = letter;
        const q = questions[idx];
        if (mode === 'quiz') {
            setTimeout(() => {
                if (idx + 1 < totalQuestions) {
                    currentPage = Math.floor((idx + 1) / perPage);
                }
                render();
            }, 800);
        }
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
