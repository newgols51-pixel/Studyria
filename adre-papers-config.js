/* ═══════════════════════════════════════════════════════════════════════
   ADRE PAPERS CONFIG — adre-papers-config.js
   Metadata for all verified ADRE papers (2022 + 2024)
   ═══════════════════════════════════════════════════════════════════════
   SOURCE: Official SLRC/ASSEB notification + official exam pattern
   VERIFICATION: Paper structure verified from official sources
   DO NOT publish papers without importing real questions from official PDFs
   ═══════════════════════════════════════════════════════════════════════ */

// Append verified paper configs to existing ADRE_PAPERS
// Papers III & IV (2024) already have full question data — don't touch them
// All other papers are added with published:false until questions are imported

(function () {
  if (!window.ADRE_PAPERS) { console.error('[ADRE] Config: ADRE_PAPERS not found'); return; }
  if (!window.ADRE_PAPERS.papers) { window.ADRE_PAPERS.papers = []; }

  var existingIds = window.ADRE_PAPERS.papers.map(function (p) { return p.id; });

  // ═══════════════════════════════════════════════════════════════════════
  // ADRE 2.0 — 2024 PAPERS (missing ones — I, II, V)
  // ═══════════════════════════════════════════════════════════════════════

  // Paper I — HSLC, Grade-IV (135 Q, 135 marks, 150 min, -0.25)
  if (existingIds.indexOf('adre-2024-paper1') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2024-paper1',
      edition: 'ADRE 2.0', year: 2024, paper_code: 'I',
      level: 'HSLC (Class 10)', grade: 'Grade-IV',
      title: 'ADRE 2.0 — 2024 · Paper I',
      subtitle: 'HSLC Level — Grade IV',
      total_questions: 135, total_marks: 135, marks_per_question: 1,
      duration_minutes: 150, negative_marking: 0.25,
      exam_date: '2024-10-27',
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFIED_OFFICIAL',
      source: 'Official SLRC-2024 Exam Pattern Notification',
      published: false, questions_imported: false, questions: []
    });
  }

  // Paper II — Class VIII, Grade-IV (135 Q, 135 marks, 150 min, -0.25)
  if (existingIds.indexOf('adre-2024-paper2') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2024-paper2',
      edition: 'ADRE 2.0', year: 2024, paper_code: 'II',
      level: 'Class VIII', grade: 'Grade-IV',
      title: 'ADRE 2.0 — 2024 · Paper II',
      subtitle: 'Class VIII Level — Grade IV',
      total_questions: 135, total_marks: 135, marks_per_question: 1,
      duration_minutes: 150, negative_marking: 0.25,
      exam_date: '2024-10-27',
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFIED_OFFICIAL',
      source: 'Official SLRC-2024 Exam Pattern Notification',
      published: false, questions_imported: false, questions: []
    });
  }

  // Paper V — Driver, Grade-III (150 Q, 150 marks, 180 min, -0.25)
  if (existingIds.indexOf('adre-2024-paper5') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2024-paper5',
      edition: 'ADRE 2.0', year: 2024, paper_code: 'V',
      level: 'Driver (HSLC)', grade: 'Grade-III',
      title: 'ADRE 2.0 — 2024 · Paper V',
      subtitle: 'Driver Level — Grade III',
      total_questions: 150, total_marks: 150, marks_per_question: 1,
      duration_minutes: 180, negative_marking: 0.25,
      exam_date: '2024-09-29',
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFIED_OFFICIAL',
      source: 'Official SLRC-2024 Exam Pattern Notification',
      published: false, questions_imported: false, questions: []
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ADRE 1.0 — 2022 PAPERS (all 5)
  // ═══════════════════════════════════════════════════════════════════════

  // Paper I — HSLC, Grade-IV
  if (existingIds.indexOf('adre-2022-paper1') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2022-paper1',
      edition: 'ADRE 1.0', year: 2022, paper_code: 'I',
      level: 'HSLC (Class 10)', grade: 'Grade-IV',
      title: 'ADRE 1.0 — 2022 · Paper I',
      subtitle: 'HSLC Level — Grade IV',
      total_questions: 135, total_marks: 135, marks_per_question: 1,
      duration_minutes: 150, negative_marking: 0.25,
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFIED_OFFICIAL',
      source: 'Official SLRC-2022 Exam Pattern',
      published: false, questions_imported: false, questions: []
    });
  }

  // Paper II — Class VIII, Grade-IV
  if (existingIds.indexOf('adre-2022-paper2') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2022-paper2',
      edition: 'ADRE 1.0', year: 2022, paper_code: 'II',
      level: 'Class VIII', grade: 'Grade-IV',
      title: 'ADRE 1.0 — 2022 · Paper II',
      subtitle: 'Class VIII Level — Grade IV',
      total_questions: 135, total_marks: 135, marks_per_question: 1,
      duration_minutes: 150, negative_marking: 0.25,
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFIED_OFFICIAL',
      source: 'Official SLRC-2022 Exam Pattern',
      published: false, questions_imported: false, questions: []
    });
  }

  // Paper III — HSSLC, Grade-III
  if (existingIds.indexOf('adre-2022-paper3') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2022-paper3',
      edition: 'ADRE 1.0', year: 2022, paper_code: 'III',
      level: 'HSSLC (Class 12)', grade: 'Grade-III',
      title: 'ADRE 1.0 — 2022 · Paper III',
      subtitle: 'HSSLC Level — Grade III',
      total_questions: 150, total_marks: 150, marks_per_question: 1,
      duration_minutes: 180, negative_marking: 0.25,
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFIED_OFFICIAL',
      source: 'Official SLRC-2022 Exam Pattern',
      published: false, questions_imported: false, questions: []
    });
  }

  // Paper IV — Degree, Grade-III (variable marking)
  if (existingIds.indexOf('adre-2022-paper4') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2022-paper4',
      edition: 'ADRE 1.0', year: 2022, paper_code: 'IV',
      level: "Bachelor's Degree", grade: 'Grade-III',
      title: 'ADRE 1.0 — 2022 · Paper IV',
      subtitle: "Bachelor's Degree Level — Grade III",
      total_questions: 150, total_marks: 175, marks_per_question: 1,
      duration_minutes: 180, negative_marking: 0.25,
      negative_per_wrong_2mark: 0.50,
      special_marking: 'Q1-125: 1 mark each, Q126-150: 2 marks each (Reading Comprehension)',
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFIED_OFFICIAL',
      source: 'Official SLRC-2022 Exam Pattern',
      published: false, questions_imported: false, questions: []
    });
  }

  // Paper V — Driver, Grade-III
  if (existingIds.indexOf('adre-2022-paper5') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2022-paper5',
      edition: 'ADRE 1.0', year: 2022, paper_code: 'V',
      level: 'Driver (HSLC)', grade: 'Grade-III',
      title: 'ADRE 1.0 — 2022 · Paper V',
      subtitle: 'Driver Level — Grade III',
      total_questions: 150, total_marks: 150, marks_per_question: 1,
      duration_minutes: 180, negative_marking: 0.25,
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFIED_OFFICIAL',
      source: 'Official SLRC-2022 Exam Pattern',
      published: false, questions_imported: false, questions: []
    });
  }

  console.log('[ADRE] Config loaded — ' + window.ADRE_PAPERS.papers.length + ' total paper(s) registered');
})();
