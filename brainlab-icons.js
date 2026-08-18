// brainlab-icons.js — Studyria BrainLab Premium Icon System
// PURELY VISUAL / ADDITIVE. Does not touch any BrainLab logic, routing, or state.
// Provides a shared library of crisp inline-SVG line icons (24x24, stroke=currentColor)
// plus larger "hero" composite icons — one distinctive visual metaphor per BrainLab section.
// brainlab.js / brainlab-ext.js consume this via window.BLIcons; if this file fails to
// load for any reason, all call-sites fall back to the plain emoji they had before
// (see the `||` fallback pattern used at each call-site), so nothing can break.
(function(){
'use strict';

var S='<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">';
var E='</svg>';

// ── Category / topic glyphs (used inside per-card badges across sections) ──
var ICONS={
  brain:S+'<path d="M9 3.5c-2 0-3.5 1.5-3.5 3.2 0 .6.15 1.15.4 1.6C4.7 9 4 10.2 4 11.6c0 1.3.6 2.4 1.6 3.1-.4.6-.6 1.3-.6 2 0 2 1.7 3.3 3.6 3.3.5 0 1-.1 1.4-.3V4.4c-.3-.5-.6-.9-1-.9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 3.5c2 0 3.5 1.5 3.5 3.2 0 .6-.15 1.15-.4 1.6 1.2.7 1.9 1.9 1.9 3.3 0 1.3-.6 2.4-1.6 3.1.4.6.6 1.3.6 2 0 2-1.7 3.3-3.6 3.3-.5 0-1-.1-1.4-.3V4.4c.3-.5.6-.9 1-.9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 4v15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'+E,
  mountain:S+'<path d="M3 18.5 9 8l3.6 6.2M12.5 18.5 16 12l5 6.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><path d="M3 18.5h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="17" cy="7.5" r="1.6" stroke="currentColor" stroke-width="1.4"/>'+E,
  scale:S+'<path d="M12 3v3M12 6l-6 12M12 6l6 12M4.5 15h5M14.5 15h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15c0 1.4 1.1 2.5 2.5 2.5s2.5-1.1 2.5-2.5M14.5 15c0 1.4 1.1 2.5 2.5 2.5s2.5-1.1 2.5-2.5" stroke="currentColor" stroke-width="1.6"/><path d="M6 20h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'+E,
  scroll:S+'<path d="M7 4h11v13.5a2.5 2.5 0 0 1-2.5 2.5H9" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 4a2.5 2.5 0 0 0-2.5 2.5V17a2.5 2.5 0 0 0 2.5 2.5" stroke="currentColor" stroke-width="1.6"/><path d="M10 8h5M10 11.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'+E,
  map:S+'<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="1.6"/>'+E,
  flask:S+'<path d="M9.5 3h5M10 3v6.2L5.7 17a2 2 0 0 0 1.8 2.9h9a2 2 0 0 0 1.8-2.9L14 9.2V3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 15h8" stroke="currentColor" stroke-width="1.5"/><circle cx="10.5" cy="17" r=".6" fill="currentColor"/><circle cx="13" cy="17.8" r=".5" fill="currentColor"/>'+E,
  coin:S+'<circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.8v8.4M14.3 9.6c0-1-1-1.7-2.3-1.7s-2.3.7-2.3 1.7c0 2.4 4.6 1.2 4.6 3.6 0 1-1 1.7-2.3 1.7s-2.3-.7-2.3-1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'+E,
  pen:S+'<path d="M4 20l1-4.2L15.2 5.6a1.5 1.5 0 0 1 2.1 0l1.1 1.1a1.5 1.5 0 0 1 0 2.1L8.2 19 4 20Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M13.8 7 17 10.2" stroke="currentColor" stroke-width="1.6"/>'+E,
  puzzle:S+'<path d="M9 4h3.2a1.4 1.4 0 0 1 1.4 1.6c-.1.9.6 1.7 1.5 1.6.9-.1 1.7.6 1.7 1.5v3.2c0 .8-.7 1.4-1.5 1.3a1.4 1.4 0 0 0-1.6 1.6c.1.9-.6 1.7-1.5 1.6H9v-3.2c0-.9-.9-1.5-1.7-1.1a1.5 1.5 0 0 1-2.1-1.4v-2.9a1.5 1.5 0 0 1 2.1-1.4c.8.4 1.7-.2 1.7-1.1V4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'+E,
  calculator:S+'<rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><rect x="7.3" y="5.3" width="9.4" height="3.6" rx=".6" stroke="currentColor" stroke-width="1.4"/><circle cx="8.2" cy="12.3" r=".9" fill="currentColor"/><circle cx="12" cy="12.3" r=".9" fill="currentColor"/><circle cx="15.8" cy="12.3" r=".9" fill="currentColor"/><circle cx="8.2" cy="16" r=".9" fill="currentColor"/><circle cx="12" cy="16" r=".9" fill="currentColor"/><circle cx="15.8" cy="16" r=".9" fill="currentColor"/>'+E,
  laptop:S+'<rect x="4" y="4.5" width="16" height="10.5" rx="1.4" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 18.5h19M9 15v1.5M15 15v1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 8.3l1.8 1.8L8 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 12h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'+E,
  leaf:S+'<path d="M5 19c-1.2-6 1.5-13 13.5-14.5C20 12.3 14.3 18.8 5 19Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.5 17.5C10 13 13 10 17.5 5.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'+E,
  clock:S+'<circle cx="12" cy="12" r="8.3" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5V12l3.2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'+E,
  book:S+'<path d="M4 5.2C4 4 5 3.3 6.2 3.4c1.9.2 3.7.9 5.3 2v14C9.9 18.3 8.1 17.6 6.2 17.4 5 17.3 4 16.5 4 15.3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M20 5.2c0-1.2-1-1.9-2.2-1.8-1.9.2-3.7.9-5.3 2v14c1.6-1.1 3.4-1.8 5.3-2 1.2-.1 2.2-.9 2.2-2.1Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'+E,
  globeNews:S+'<circle cx="10.3" cy="9.3" r="5.3" stroke="currentColor" stroke-width="1.5"/><path d="M5.4 9.3h9.8M10.3 4c1.6 1.4 2.5 3.2 2.5 5.3s-.9 3.9-2.5 5.3c-1.6-1.4-2.5-3.2-2.5-5.3S8.7 5.4 10.3 4Z" stroke="currentColor" stroke-width="1.3"/><path d="M14.5 13.5h5a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-8.6l-2.4 2v-2a1 1 0 0 1-1-1v-1.6" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15.8 16h3.2M15.8 17.8h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'+E,
  building:S+'<path d="M5 20.5V6.8L12 3l7 3.8v13.7" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3.2 20.5h17.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8.5 20.5v-6h7v6" stroke="currentColor" stroke-width="1.5"/><path d="M9 9.5h.01M12 9.5h.01M15 9.5h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'+E,
  shieldBadge:S+'<path d="M12 3.3 19 6v6.2c0 4.4-3 7.4-7 8.5-4-1.1-7-4.1-7-8.5V6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12.1l2.2 2.2 4-4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'+E,
  train:S+'<rect x="5" y="4.5" width="14" height="11.5" rx="2.5" stroke="currentColor" stroke-width="1.6"/><path d="M5 10.5h14" stroke="currentColor" stroke-width="1.5"/><circle cx="8.5" cy="13.3" r="1" fill="currentColor"/><circle cx="15.5" cy="13.3" r="1" fill="currentColor"/><path d="M8 20l1.5-2.8h5L16 20M3.5 8h1.5M19 8h1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'+E,
  bank:S+'<path d="M4 9.5 12 4l8 5.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 9.5h16v1.6H4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 12v6.3M10.3 12v6.3M13.7 12v6.3M18 12v6.3" stroke="currentColor" stroke-width="1.5"/><path d="M4 19.5h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'+E,
  target:S+'<circle cx="12" cy="12" r="8.3" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4.8" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>'+E,
  document:S+'<path d="M7 3.5h7.2L18 7.3v12.2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3.5V7a1 1 0 0 0 1 1h3" stroke="currentColor" stroke-width="1.5"/><path d="M8.6 12h6.8M8.6 15h6.8M8.6 9h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'+E,
  cardsStack:S+'<rect x="4.5" y="7.5" width="12" height="9" rx="1.6" stroke="currentColor" stroke-width="1.5" transform="rotate(-6 10.5 12)"/><rect x="7.5" y="6.2" width="12" height="9" rx="1.6" fill="var(--bl-icon-bg,#fff)" stroke="currentColor" stroke-width="1.6"/>'+E,
  flame:S+'<path d="M12 3c1 2.6-.6 3.8-1.7 5.3-1.1 1.5-1.6 3-1.2 4.6.3-1.3 1.2-2 1.9-2.4-.2 1.6.5 2.7 1.6 3.4.3-1 1-1.5 1.7-1.9-.1 1.1.3 2 1.1 2.7 1.6-1.1 2.6-2.9 2.6-5 0-4-2.6-6.6-6-6.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.5 15.3c-.4 3 1.6 5 3.6 5.2 2.4.2 4.4-1.6 4.6-3.9.1-1.5-.5-2.7-1.3-3.6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'+E,
  checkFix:S+'<path d="M5 6l4 4M9 6L5 10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M13 12h7M13 12l2.3-2.3M13 12l2.3 2.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 15.3l2.7 2.7 5.3-5.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'+E,
  meter:S+'<path d="M4 15.5a8 8 0 1 1 16 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 15.5 16 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/>'+E,
  trophy:S+'<path d="M8 4h8v5.2a4 4 0 0 1-8 0Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 5.5H5.6A1.6 1.6 0 0 0 4 7.1c0 2 1.5 3.6 3.5 3.7M16 5.5h2.4A1.6 1.6 0 0 1 20 7.1c0 2-1.5 3.6-3.5 3.7" stroke="currentColor" stroke-width="1.5"/><path d="M12 13.2V16M9 20h6M8.5 20c0-1.8 1.3-2.7 3.5-2.7s3.5.9 3.5 2.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'+E,
  fourChoice:S+'<rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="9.3" r="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M12.2 9.3h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="14.3" r="1.5" fill="currentColor"/><path d="M6.6 14.9l.9.9 1.9-2.1" stroke="var(--bl-icon-bg,#fff)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.2 14.3h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'+E,
  gk:S+'<circle cx="12" cy="10.5" r="6.3" stroke="currentColor" stroke-width="1.6"/><path d="M9.7 8.6a2.3 2.3 0 1 1 3.5 2c-.7.5-1.2 1-1.2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="14.9" r=".2" fill="currentColor" stroke="currentColor" stroke-width="1.2"/><path d="M9 20.5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'+E
};

// ── Section hero glyphs — ONE distinctive multi-element composite per section ──
var HERO={
  quizzes:S+'<circle cx="10" cy="12" r="7.3" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="12" r="4.1" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="12" r="1.1" fill="currentColor"/><path d="M15.3 6.7 20 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M17.5 3.6l2 2-4.2 4.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 15.5l1.6 1.6-3 3-1.6-1.6Z" fill="currentColor" opacity=".16"/>'+E,
  mockTests:S+'<rect x="5.5" y="3.5" width="10" height="17" rx="1.6" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 3.5V2.2h4v1.3" stroke="currentColor" stroke-width="1.5"/><path d="M8 8h5.6M8 11h5.6M8 14h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="17.3" cy="15.3" r="4.3" stroke="currentColor" stroke-width="1.5"/><path d="M17.3 13v2.3l1.7 1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'+E,
  pyq:S+'<path d="M6 5.2h9.4L19 8.8v10.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6.2a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15.4 5.2v3.6H19" stroke="currentColor" stroke-width="1.4"/><path d="M7.6 12.5h6.8M7.6 15h6.8M7.6 10h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><rect x="3" y="3" width="9.4" height="12.2" rx="1" fill="var(--bl-hero-bg,#fdf6ee)" stroke="currentColor" stroke-width="1.4" opacity=".55"/>'+E,
  mcqs:S+'<rect x="4" y="4" width="16" height="16" rx="2.2" stroke="currentColor" stroke-width="1.5"/><path d="M8 8.6h8M8 8.6a1 1 0 1 1 0 .01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7.4" cy="8.6" r="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="7.4" cy="12" r="1.5" fill="currentColor"/><path d="M6.6 12l.6.6 1.2-1.4" stroke="var(--bl-hero-bg,#fdf6ee)" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7.4" cy="15.4" r="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M11 12h5M11 15.4h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'+E,
  flashcards:S+'<rect x="6.3" y="6.3" width="12.5" height="9.4" rx="1.8" stroke="currentColor" stroke-width="1.5" transform="rotate(-8 12.5 11)" opacity=".55"/><rect x="5" y="8" width="12.5" height="9.4" rx="1.8" fill="var(--bl-hero-bg,#fdf6ee)" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 12.7h5.5M8.5 15h3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M17.3 5.3a1.6 1.6 0 1 1 1.9 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="18.6" cy="9.4" r=".35" fill="currentColor"/>'+E,
  currentAffairs:S+'<circle cx="9.3" cy="10.3" r="5.8" stroke="currentColor" stroke-width="1.5"/><path d="M3.6 10.3h11.4M9.3 4.5c1.8 1.5 2.8 3.5 2.8 5.8s-1 4.3-2.8 5.8c-1.8-1.5-2.8-3.5-2.8-5.8S7.5 6 9.3 4.5Z" stroke="currentColor" stroke-width="1.3"/><path d="M14.5 8.8h5.8a1 1 0 0 1 1 1V17a1 1 0 0 1-1 1h-9l-2.6 2.1V18" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M16 11.6h3.4M16 13.7h2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'+E,
  mistakes:S+'<circle cx="8.6" cy="8.6" r="4.6" stroke="currentColor" stroke-width="1.5"/><path d="M6.9 6.9l3.4 3.4M10.3 6.9 6.9 10.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11.5 17.5h7.3M15 14.2l3.8 3.3-3.8 3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 17.8l2.4 2.4 4.6-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'+E,
  daily:S+'<path d="M12 3.3c1.1 2.9-.7 4.3-1.9 6-1.2 1.7-1.8 3.4-1.3 5.2.3-1.5 1.3-2.3 2.1-2.7-.2 1.8.6 3 1.8 3.8.3-1.1 1.1-1.7 1.9-2.1-.1 1.2.3 2.2 1.2 3 1.8-1.2 2.9-3.2 2.9-5.6 0-4.5-2.9-7.4-6.7-7.6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.2 16.9c-.4 3.4 1.8 5.6 4 5.8 2.7.2 4.9-1.8 5.1-4.4.1-1.6-.5-3-1.4-4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'+E
};

var badgeClass={
  quizzes:'bl-icon-quizzes', mockTests:'bl-icon-mocks', pyq:'bl-icon-pyq', mcqs:'bl-icon-mcqs',
  flashcards:'bl-icon-flashcards', currentAffairs:'bl-icon-affairs', mistakes:'bl-icon-mistakes', daily:'bl-icon-daily'
};

window.BLIcons={
  /** Small per-card badge icon. name = key in ICONS. section = key in badgeClass for accent tint. */
  badge:function(name,section){
    var svg=ICONS[name];
    if(!svg)return null;
    var cls='bl-icon-badge'+(section&&badgeClass[section]?' '+badgeClass[section]:'');
    return '<div class="'+cls+'">'+svg+'</div>';
  },
  /** Larger section hero icon for section headers / promo banners. */
  hero:function(section){
    var svg=HERO[section];
    if(!svg)return null;
    var cls='bl-hero-icon'+(badgeClass[section]?' '+badgeClass[section]:'');
    return '<div class="'+cls+'">'+svg+'</div>';
  }
};

})();
