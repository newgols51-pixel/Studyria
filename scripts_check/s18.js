
function studyriaApp() {
  return {
    // ── STATE ──────────────────────────────────────────────────────
    isDarkMode:    localStorage.getItem('studyria_theme') !== 'light',
    sidebarOpen:   false,
    annBarVisible: false,

    // ── LIFECYCLE ─────────────────────────────────────────────────
    init() {
      // Expose this Alpine proxy to legacy JS so bridges work
      window._alpine = this;
      // Keep the legacy `dark` variable in sync with Alpine state
      window.dark = this.isDarkMode;
      // Sync SVG icon on first load
      this._syncThemeIcon(this.isDarkMode);

      // Reactively sync theme changes → localStorage + dark var + icon
      this.$watch('isDarkMode', v => {
        window.dark = v;
        localStorage.setItem('studyria_theme', v ? 'dark' : 'light');
        this._syncThemeIcon(v);
      });
    },

    // ── ACTIONS ───────────────────────────────────────────────────
    toggleTheme() {
      this.isDarkMode = !this.isDarkMode;
    },

    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen;
    },

    closeAnnBar() {
      this.annBarVisible = false;
      try {
        const id = document.getElementById('announcementBar').dataset.annId;
        if (id) localStorage.setItem('studyria_ann_closed_id', id);
      } catch(e) {}
    },

    // ── HELPERS ───────────────────────────────────────────────────
    _syncThemeIcon(dark) {
      const icon = document.getElementById('themeIcon');
      if (icon) icon.setAttribute('href', dark ? '#ic-moon' : '#ic-sun');
    }
  };
}
