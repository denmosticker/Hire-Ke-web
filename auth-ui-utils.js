// Shared UI helpers (safe to include on pages that don't use them)

(function () {
  function setupPasswordToggle(opts) {
    if (!opts) return;
    const input = document.getElementById(opts.inputId);
    const button = document.getElementById(opts.toggleButtonId);
    if (!input || !button) return;
    if (button.dataset.listenerBound) return;
    button.dataset.listenerBound = 'true';

    // If the button has no icon, don't break.
    button.addEventListener('click', () => {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';

      const icon = button.querySelector('i');
      if (icon) {
        // Prefer fa-eye / fa-eye-slash, but don't rely on them existing.
        icon.classList.toggle('fa-eye', !isPassword);
        icon.classList.toggle('fa-eye-slash', isPassword);
      }

      // Improve accessibility
      button.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  }

  // Expose
  window.setupPasswordToggle = setupPasswordToggle;
})();

