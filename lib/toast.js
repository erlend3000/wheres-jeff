let container = null;

const ERROR_MAP = {
    'Password should be at least 6 characters':     'Password too short (min 6)',
    'Unable to validate email address: invalid format': 'Invalid email address',
    'Invalid login credentials':                    'Wrong email or password',
    'Email rate limit exceeded':                    'Too many attempts',
    'User already registered':                      'Email already registered',
    'Signup requires a valid password':             'Enter a password',
    'To signup, please provide your email':         'Enter an email address',
    'Email not confirmed':                          'Email not confirmed',
};

function mapMessage(msg) {
    for (const [key, val] of Object.entries(ERROR_MAP)) {
        if (msg.includes(key)) return val;
    }
    if (msg.includes('you can only request this after')) return 'Please wait a moment';
    return msg;
}

function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

/**
 * @param {string} message
 * @param {object} [opts]
 * @param {number} [opts.duration=4000]
 * @param {'info'|'error'} [opts.type='info']
 */
export function showToast(message, { duration = 4000, type = 'info' } = {}) {
    const el = ensureContainer();
    const mapped = type === 'error' ? mapMessage(message) : message;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;

    const accent = type === 'error' ? '<div class="toast__accent"></div>' : '';
    toast.innerHTML = `${accent}<span class="toast__text">${mapped}</span>`;

    el.prepend(toast);
    requestAnimationFrame(() => toast.classList.add('toast--visible'));

    setTimeout(() => {
        toast.classList.remove('toast--visible');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}
