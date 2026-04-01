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
        const isPassword = type === 'password';

        this.classList.add('field');
        if (variant === 'display') this.classList.add('field--display');

        const eyeBtn = isPassword
            ? `<button type="button" class="field__toggle" aria-label="Show password">${EYE_OPEN}</button>`
            : '';

        const readonlyAttr = variant === 'display' ? 'readonly tabindex="-1"' : '';

        this.innerHTML = `
            <span class="field__label">${label}</span>
            <div class="field__input-wrapper">
                <input class="field__input" type="${type}" name="${name}" placeholder="${placeholder}" ${readonlyAttr}>
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
            });
        }
    }

    get value() {
        const input = this.querySelector('.field__input');
        return input ? input.value : '';
    }

    set value(val) {
        const input = this.querySelector('.field__input');
        if (input) input.value = val;
    }

    get fieldName() {
        return this.getAttribute('name') || this.getAttribute('label')?.toLowerCase() || '';
    }
}

customElements.define('wheff-field', WheffField);
