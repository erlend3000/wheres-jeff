class WheffBanner extends HTMLElement {
    connectedCallback() {
        if (this._rendered) return;
        requestAnimationFrame(() => {
            if (this._rendered) return;
            this._rendered = true;
            this._render();
        });
    }

    _render() {
        const position = this.getAttribute('position') || 'top';
        const from = this.getAttribute('from') || (position === 'top' ? 'left' : 'right');
        const action = this.getAttribute('action');
        const size = this.getAttribute('size');
        const variant = this.getAttribute('variant');
        const text = this.textContent.trim();

        this.className = `banner banner--${position} banner--from-${from}`;

        if (size) this.classList.add(`banner--${size}`);
        if (variant) this.classList.add(`banner--${variant}`);

        if (action) {
            this.classList.add('banner--action');
            this.setAttribute('role', 'button');
            this.setAttribute('tabindex', '0');
        }

        this.innerHTML = `<span class="banner__text">${text}</span>`;

        if (action) {
            this.addEventListener('click', (originalEvent) => {
                this.dispatchEvent(new CustomEvent('wheff-action', {
                    bubbles: true,
                    detail: { action, shiftKey: originalEvent.shiftKey }
                }));
            });
            this.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.click();
            });
        }
    }
}

customElements.define('wheff-banner', WheffBanner);
