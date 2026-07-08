
  tailwind = { config: {
    theme: {
      extend: {
        colors: {
          accent:  'var(--color-accent)',
          accent2: 'var(--color-accent2)',
          accent3: 'var(--color-accent3)',
          gold:    'var(--color-gold)',
          danger:  'var(--color-danger)',
          success: 'var(--color-success)',
          info:    'var(--color-info)',
          bg:      'var(--bg)',
          bg2:     'var(--bg2)',
          bg3:     'var(--bg3)',
          surface: 'var(--surface)',
          glass:   'var(--glass)',
          text:    'var(--text)',
          text2:   'var(--text2)',
          text3:   'var(--text3)',
        },
        fontFamily: {
          editorial: ['Playfair Display', 'Georgia', 'serif'],
          sans:      ['Inter', 'system-ui', 'sans-serif'],
        },
        borderRadius: {
          'radius':    'var(--radius-radius)',
          'radius-sm': 'var(--radius-radius-sm)',
          'radius-lg': 'var(--radius-radius-lg)',
          'radius-xl': 'var(--radius-radius-xl)',
        },
        boxShadow: {
          glow: 'var(--shadow-glow)',
        },
        backgroundImage: {
          'grad-primary': 'var(--grad-primary)',
          'grad-hero':    'var(--grad-hero)',
          'grad-warm':    'var(--grad-warm)',
          'grad-success': 'var(--grad-success)',
          'grad-card':    'var(--grad-card)',
        },
      }
    }
  } };
