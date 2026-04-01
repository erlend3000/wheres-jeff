class WheffCard extends HTMLElement {
    connectedCallback() {
        if (this._rendered) return;
        requestAnimationFrame(() => {
            if (this._rendered) return;
            this._rendered = true;
            this._render();
        });
    }

    _render() {
        this.classList.add('card-wrapper');

        if (this.hasAttribute('aspect')) {
            this.style.setProperty('--card-aspect-ratio', this.getAttribute('aspect'));
        }

        const children = [...this.children];
        const banners = [];
        const insideBanners = [];
        const fields = [];

        children.forEach(child => {
            if (child.tagName === 'WHEFF-BANNER') {
                if (child.getAttribute('variant') === 'secondary') {
                    insideBanners.push(child);
                } else {
                    banners.push(child);
                }
            } else {
                fields.push(child);
            }
        });

        const card = document.createElement('div');
        card.className = 'card';
        fields.forEach(f => card.appendChild(f));
        insideBanners.forEach(b => card.appendChild(b));

        this.replaceChildren(card, ...banners);
    }

    getFormData() {
        const data = {};
        this.querySelectorAll('wheff-field').forEach(field => {
            data[field.fieldName] = field.value;
        });
        return data;
    }
}

customElements.define('wheff-card', WheffCard);
