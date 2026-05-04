const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';

const EYE_OPEN = `<svg ${SVG_ATTRS}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
</svg>`;

const EYE_CLOSED = `<svg ${SVG_ATTRS}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
</svg>`;

class WheffField extends HTMLElement {
    connectedCallback() {
        if (this._rendered) return;
        requestAnimationFrame(() => {
            if (this._rendered) return;
            this._rendered = true;
            this._render();
        });
    }

    _render() {
        const label = this.getAttribute('label') || '';
        const type = this.getAttribute('type') || 'text';
        const placeholder = this.getAttribute('placeholder') || '';
        const name = this.getAttribute('name') || label.toLowerCase();
        const variant = this.getAttribute('variant');
        const maxlength = this.getAttribute('maxlength');
        const isPassword = type === 'password';
        const isDisplay = variant === 'display';
        // Mirror layer renders the input's value with our custom styling on top
        // of a transparent native input. This sidesteps Chromium's autofill
        // hover-preview (which ignores all our CSS) and lets us draw a custom
        // slanted caret in the Jeff style. Password fields also get a mirror,
        // but the mirror renders bullets instead of the actual characters
        // (unless the show-password toggle is active).
        const useMirror = !isDisplay;

        // type="email" doesn't support selectionStart/End in Chrome and Safari
        // — they return null — which breaks our mirror's caret tracking and
        // selection rendering. Switch to type="text" while preserving the
        // semantics we actually want (mobile email keyboard via inputmode,
        // browser autofill via autocomplete, no auto-capitalise, no spellcheck,
        // and a `data-type="email"` marker so callers can still identify the
        // field's intent). Format validation already lives in login.html JS.
        const isEmail = type === 'email';
        const actualType = isEmail ? 'text' : type;
        const emailAttrs = isEmail
            ? 'inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" data-type="email"'
            : '';

        this.classList.add('field');
        if (isDisplay) this.classList.add('field--display');

        const eyeBtn = isPassword
            ? `<button type="button" class="field__toggle" aria-label="Show password">${EYE_OPEN}</button>`
            : '';

        const mirrorHtml = useMirror
            ? `<span class="field__input-mirror" aria-hidden="true"><span class="field__input-mirror-inner"><span class="field__input-mirror-pre"></span><span class="field__input-mirror-selection"></span><span class="field__input-caret"><span class="field__input-caret-char"></span></span><span class="field__input-mirror-post"></span></span></span>`
            : '';

        const readonlyAttr = isDisplay ? 'readonly tabindex="-1"' : '';
        const maxlengthAttr = maxlength ? `maxlength="${maxlength}"` : '';
        const wrapperClass = useMirror ? 'field__input-wrapper field__input-wrapper--mirrored' : 'field__input-wrapper';

        this.innerHTML = `
            <span class="field__label">${label}</span>
            <div class="${wrapperClass}">
                <input class="field__input" type="${actualType}" name="${name}" placeholder="${placeholder}" ${readonlyAttr} ${maxlengthAttr} ${emailAttrs}>
                ${mirrorHtml}
                ${eyeBtn}
            </div>
        `;

        if (isPassword) {
            const toggle = this.querySelector('.field__toggle');
            const input = this.querySelector('.field__input');
            toggle.addEventListener('click', () => {
                const visible = input.type === 'text';
                input.type = visible ? 'password' : 'text';
                input.classList.toggle('field__input--visible', !visible);
                toggle.innerHTML = visible ? EYE_OPEN : EYE_CLOSED;
                // Re-render the mirror so bullets / plain text swap to match
                // the new input type.
                if (this._mirrorUpdate) this._mirrorUpdate(true);
            });
        }

        if (useMirror) this._wireMirror();
    }

    _wireMirror() {
        const input = this.querySelector('.field__input');
        const inner = this.querySelector('.field__input-mirror-inner');
        const pre = this.querySelector('.field__input-mirror-pre');
        const sel = this.querySelector('.field__input-mirror-selection');
        const caretEl = this.querySelector('.field__input-caret');
        const caretChar = this.querySelector('.field__input-caret-char');
        const post = this.querySelector('.field__input-mirror-post');
        if (!input || !inner || !pre || !sel || !caretEl || !caretChar || !post) return;

        // Force the native caret hidden via inline style. CSS rules sometimes
        // lose to UA stylesheet defaults on Safari focus state, but inline
        // styles with `important` are the highest specificity available.
        input.style.setProperty('caret-color', 'transparent', 'important');

        // Mirror native input scrolling so long text scrolls left to keep the
        // caret visible. Browsers update input.scrollLeft after layout, so we
        // sync on the scroll event (fired by browser) and on a RAF after our
        // own value/selection updates.
        const syncScroll = () => {
            const sx = input.scrollLeft || 0;
            // Use the `translate` property (not `transform`) so we don't
            // clobber the skewX applied via CSS.
            inner.style.translate = sx ? `${-sx}px 0` : '';
        };

        // Dedupe so we don't mutate mirror DOM when nothing has actually
        // changed. Repeated DOM mutations during the first click can cause
        // the autofill dropdown to dismiss itself on Arc/Safari.
        let lastSnapshot = '';
        const BULLET = '\u2022';
        const update = (force) => {
            const rawValue = input.value;
            const isHidden = input.type === 'password';
            // Mirror shows bullets when the field is in password mode,
            // and the actual value when the show-password toggle is active.
            const display = isHidden ? BULLET.repeat(rawValue.length) : rawValue;
            // Place the caret block at selectionEnd so the cursor visually
            // sits at the forward end of any selection (terminal convention).
            const start = input.selectionStart ?? rawValue.length;
            const end = input.selectionEnd ?? rawValue.length;
            const cursorAt = end;
            const charAtCursor = display.charAt(cursorAt);
            const snapshot = `${input.type}\u0001${rawValue}\u0001${start}\u0001${end}`;
            if (!force && snapshot === lastSnapshot) {
                requestAnimationFrame(syncScroll);
                return;
            }
            lastSnapshot = snapshot;
            pre.textContent = display.substring(0, start);
            sel.textContent = display.substring(start, end);
            if (charAtCursor) {
                caretChar.textContent = charAtCursor;
                caretEl.classList.remove('field__input-caret--end');
            } else {
                caretChar.textContent = '';
                caretEl.classList.add('field__input-caret--end');
            }
            // Post starts after the caret-character, if there was one.
            post.textContent = display.substring(cursorAt + (charAtCursor ? 1 : 0));
            requestAnimationFrame(syncScroll);
            // Restart the blink from the visible ("on") phase so fast
            // arrow-key navigation never lands on the invisible half.
            const anims = caretEl.getAnimations
                ? caretEl.getAnimations({ subtree: true })
                : [];
            const charAnims = caretChar.getAnimations
                ? caretChar.getAnimations()
                : [];
            for (const a of anims) a.currentTime = 0;
            for (const a of charAnims) a.currentTime = 0;
        };

        // `input` covers value changes (typing, paste, autofill). Caret /
        // selection movement is messier — no single event reliably fires for
        // every kind of move across browsers:
        //   - `selectionchange` on document — primary; fires on collapsed-cursor
        //     moves in modern Chrome/Safari but with inconsistent timing.
        //   - `select` — only fires for non-empty range selections (Safari).
        //   - `keyup` / `mouseup` / `pointerup` / `focus` — fast event-driven
        //     fallbacks for arrow keys, mouse clicks, drag-selections, etc.
        //   - rAF poll while focused — catch-all for anything the events miss
        //     (e.g. some Safari versions don't fire selectionchange for arrow
        //     keys at all). The poll runs only while the input is focused and
        //     the `update` dedupe prevents DOM mutations when nothing changed,
        //     so it has effectively zero cost in steady state.
        // Heavy redundancy is fine: `update` is idempotent.
        const tick = () => update();
        input.addEventListener('input', update);
        input.addEventListener('scroll', syncScroll);
        input.addEventListener('select', tick);
        input.addEventListener('keyup', tick);
        input.addEventListener('mouseup', tick);
        input.addEventListener('pointerup', tick);
        input.addEventListener('focus', tick);
        document.addEventListener('selectionchange', () => {
            if (document.activeElement === input) update();
        });

        let pollRaf = null;
        const stopPoll = () => {
            if (pollRaf) {
                cancelAnimationFrame(pollRaf);
                pollRaf = null;
            }
        };
        const poll = () => {
            if (document.activeElement !== input) {
                pollRaf = null;
                return;
            }
            update();
            pollRaf = requestAnimationFrame(poll);
        };
        input.addEventListener('focus', () => {
            stopPoll();
            pollRaf = requestAnimationFrame(poll);
        });
        input.addEventListener('blur', stopPoll);
        // If the field is already focused at wiring time (auto-focus from a
        // previous step) the focus event won't fire, so kick the poll off here.
        if (document.activeElement === input) {
            pollRaf = requestAnimationFrame(poll);
        }

        this._mirrorUpdate = update;
        update();
    }

    get value() {
        const input = this.querySelector('.field__input');
        return input ? input.value : '';
    }

    set value(val) {
        const input = this.querySelector('.field__input');
        if (input) {
            input.value = val;
            if (this._mirrorUpdate) this._mirrorUpdate();
        }
    }

    get fieldName() {
        return this.getAttribute('name') || this.getAttribute('label')?.toLowerCase() || '';
    }
}

customElements.define('wheff-field', WheffField);
