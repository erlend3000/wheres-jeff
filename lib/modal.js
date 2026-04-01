let overlay = null;

function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
    return overlay;
}

/**
 * Show a modal dialog.
 * @param {object} opts
 * @param {string} opts.label      - Small white strip label (e.g. "Jeff says")
 * @param {string} opts.text       - Main message text
 * @param {Array}  [opts.buttons]  - Array of { text, action, dismiss } objects. dismiss defaults to true.
 * @param {Function} [opts.onAction] - Callback for non-dismissing buttons: onAction(action, { setText })
 * @returns {Promise<string|null>} Resolves with the action string of a dismissing button click
 */
export function showModal({ label, text, buttons = [], onAction }) {
    const el = ensureOverlay();

    const hasButtons = buttons.length > 0;
    const buttonsHtml = hasButtons
        ? `<div class="modal__buttons">${buttons.map(b =>
            `<button class="modal__btn" data-action="${b.action}" data-dismiss="${b.dismiss !== false}"><span class="modal__btn-text">${b.text}</span></button>`
          ).join('')}</div>`
        : '';

    el.innerHTML = `
        <div class="modal ${hasButtons ? 'modal--has-buttons' : ''}">
            <div class="modal__label">
                <span class="modal__label-text">${label}</span>
            </div>
            <div class="modal__body">
                <span class="modal__text">${text}</span>
            </div>
            ${buttonsHtml}
        </div>
    `;

    const textEl = el.querySelector('.modal__text');
    const helpers = {
        setText(newText) {
            textEl.textContent = newText;
        }
    };

    requestAnimationFrame(() => el.classList.add('active'));

    return new Promise(resolve => {
        el.querySelectorAll('.modal__btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (btn.dataset.dismiss === 'true') {
                    hideModal();
                    resolve(action);
                } else if (onAction) {
                    onAction(action, helpers);
                }
            });
        });
    });
}

export function hideModal() {
    if (!overlay) return;
    overlay.classList.remove('active');
}
