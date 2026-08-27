/* ADRE PAPERS CONFIG — adre-papers-config.js
   Metadata for all verified ADRE papers (2022 + 2024)
   Only papers with published:true AND imported questions are playable.
   Others show as "Coming Soon" — no fabricated questions.

   SOURCES VERIFIED:
   - jobassam.in/adre-question-papers/ (official exam dates + patterns)
   - slrcg3.sebaonline.org (official answer key URLs)
   - ASSEB/SLRC official exam pattern notification 2024

   ADRE 2.0 (2024) Exam Dates (confirmed):
   Paper I   HSLC Grade-IV      27 Oct 2024  135Q 135marks 150min
   Paper II  Class VIII Grade-IV 27 Oct 2024  135Q 135marks 150min
   Paper III HSSLC Grade-III     15 Sep 2024  150Q 150marks 180min
   Paper IV  Degree Grade-III     29 Sep 2024  150Q 175marks 180min
   Paper V   Driver Grade-III     29 Sep 2024  150Q 150marks 180min

   Negative marking: -0.25 per 1-mark Q, -0.50 per 2-mark Q (Paper IV only)
*/

(function () {
  if (!window.ADRE_PAPERS) { console.error('[ADRE] Config: ADRE_PAPERS not found'); return; }
  if (!window.ADRE_PAPERS.papers) { window.ADRE_PAPERS.papers = []; }

  var existingIds = window.ADRE_PAPERS.papers.map(function (p) { return p.id; });

  // ADRE 2.0 2024 Paper I — HSLC, Grade-IV
  if (existingIds.indexOf('adre-2024-paper1') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2024-paper1', edition: 'ADRE 2.0', year: 2024, paper_code: 'I',
      level: 'HSLC (Class 10)', grade: 'Grade-IV',
      title: 'ADRE 2.0 \u2014 2024 \u00b7 Paper I', subtitle: 'HSLC Level \u2014 Grade IV',
      total_questions: 135, total_marks: 135, marks_per_question: 1,
      duration_minutes: 150, negative_marking: 0.25, exam_date: '2024-10-27',
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFICATION_PENDING',
      source: 'Official SLRC-2024 Exam Pattern (jobassam.in verified)',
      published: false, questions_imported: false, questions: []
    });
  }

  // ADRE 2.0 2024 Paper II — Class VIII, Grade-IV
  if (existingIds.indexOf('adre-2024-paper2') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2024-paper2', edition: 'ADRE 2.0', year: 2024, paper_code: 'II',
      level: 'Class VIII', grade: 'Grade-IV',
      title: 'ADRE 2.0 \u2014 2024 \u00b7 Paper II', subtitle: 'Class VIII Level \u2014 Grade IV',
      total_questions: 135, total_marks: 135, marks_per_question: 1,
      duration_minutes: 150, negative_marking: 0.25, exam_date: '2024-10-27',
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFICATION_PENDING',
      source: 'Official SLRC-2024 Exam Pattern (jobassam.in verified)',
      published: false, questions_imported: false, questions: []
    });
  }

  
  // ADRE 2.0 2024 Paper III — HSSLC, Grade-III
  if (existingIds.indexOf('adre-2024-paper3') === -1) {
    existingIds.push('adre-2024-paper3');
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2024-paper3', edition: 'ADRE 2.0', year: 2024, paper_code: 'III',
      level: 'HSSLC (Class 12)', grade: 'Grade-III',
      title: 'ADRE 2.0 \u2014 2024 \u00b7 Paper III', subtitle: 'HSSLC Level \u2014 Grade III',
      total_questions: 150, total_marks: 150, marks_per_question: 1,
      duration_minutes: 180, negative_marking: 0.25, negative_per_wrong_2mark: 0,
      exam_date: '2024-09-15',
      source: 'Official SLRC-2024 Exam \u2014 Set A + Official Answer Key',
      published: false, questions_imported: false, questions: []
    });
  }

  // ADRE 2.0 2024 Paper IV — Degree, Grade-III (variable marking)
  if (existingIds.indexOf('adre-2024-paper4') === -1) {
    existingIds.push('adre-2024-paper4');
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2024-paper4', edition: 'ADRE 2.0', year: 2024, paper_code: 'IV',
      level: "Bachelor's Degree", grade: 'Grade-III',
      title: 'ADRE 2.0 \u2014 2024 \u00b7 Paper IV', subtitle: "Bachelor's Degree Level \u2014 Grade III",
      total_questions: 150, total_marks: 175, marks_per_question: 1,
      duration_minutes: 180, negative_marking: 0.25, negative_per_wrong_2mark: 0.50,
      exam_date: '2024-09-29',
      source: 'Official SLRC-2024 Exam \u2014 Set A + Official Answer Key',
      published: false, questions_imported: false, questions: []
    });
  }

// ADRE 2.0 2024 Paper V — Driver, Grade-III
  if (existingIds.indexOf('adre-2024-paper5') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2024-paper5', edition: 'ADRE 2.0', year: 2024, paper_code: 'V',
      level: 'Driver (HSLC)', grade: 'Grade-III',
      title: 'ADRE 2.0 \u2014 2024 \u00b7 Paper V', subtitle: 'Driver Level \u2014 Grade III',
      total_questions: 150, total_marks: 150, marks_per_question: 1,
      duration_minutes: 180, negative_marking: 0.25, exam_date: '2024-09-29',
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFICATION_PENDING',
      source: 'Official SLRC-2024 Exam Pattern (jobassam.in verified)',
      published: false, questions_imported: false, questions: []
    });
  }

  // ADRE 1.0 2022 Paper I — HSLC, Grade-IV
  if (existingIds.indexOf('adre-2022-paper1') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2022-paper1', edition: 'ADRE 1.0', year: 2022, paper_code: 'I',
      level: 'HSLC (Class 10)', grade: 'Grade-IV',
      title: 'ADRE 1.0 \u2014 2022 \u00b7 Paper I', subtitle: 'HSLC Level \u2014 Grade IV',
      total_questions: 135, total_marks: 135, marks_per_question: 1,
      duration_minutes: 150, negative_marking: 0.25,
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFICATION_PENDING',
      source: 'Official SLRC-2022 Exam Pattern',
      published: false, questions_imported: false, questions: []
    });
  }

  // ADRE 1.0 2022 Paper II — Class VIII, Grade-IV
  if (existingIds.indexOf('adre-2022-paper2') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2022-paper2', edition: 'ADRE 1.0', year: 2022, paper_code: 'II',
      level: 'Class VIII', grade: 'Grade-IV',
      title: 'ADRE 1.0 \u2014 2022 \u00b7 Paper II', subtitle: 'Class VIII Level \u2014 Grade IV',
      total_questions: 135, total_marks: 135, marks_per_question: 1,
      duration_minutes: 150, negative_marking: 0.25,
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFICATION_PENDING',
      source: 'Official SLRC-2022 Exam Pattern',
      published: false, questions_imported: false, questions: []
    });
  }

  // ADRE 1.0 2022 Paper III — HSSLC, Grade-III
  if (existingIds.indexOf('adre-2022-paper3') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2022-paper3', edition: 'ADRE 1.0', year: 2022, paper_code: 'III',
      level: 'HSSLC (Class 12)', grade: 'Grade-III',
      title: 'ADRE 1.0 \u2014 2022 \u00b7 Paper III', subtitle: 'HSSLC Level \u2014 Grade III',
      total_questions: 150, total_marks: 150, marks_per_question: 1,
      duration_minutes: 180, negative_marking: 0.25,
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFICATION_PENDING',
      source: 'Official SLRC-2022 Exam Pattern',
      published: false, questions_imported: false, questions: []
    });
  }

  // ADRE 1.0 2022 Paper IV — Degree, Grade-III (variable marking)
  if (existingIds.indexOf('adre-2022-paper4') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2022-paper4', edition: 'ADRE 1.0', year: 2022, paper_code: 'IV',
      level: "Bachelor's Degree", grade: 'Grade-III',
      title: 'ADRE 1.0 \u2014 2022 \u00b7 Paper IV', subtitle: "Bachelor's Degree Level \u2014 Grade III",
      total_questions: 150, total_marks: 175, marks_per_question: 'variable',
      duration_minutes: 180, negative_marking: 0.25,
      negative_per_wrong_1mark: 0.25, negative_per_wrong_2mark: 0.50,
      special_marking: 'Q1-125: 1 mark each, Q126-150: 2 marks each (Reading Comprehension)',
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFICATION_PENDING',
      source: 'Official SLRC-2022 Exam Pattern',
      published: false, questions_imported: false, questions: []
    });
  }

  // ADRE 1.0 2022 Paper V — Driver, Grade-III
  if (existingIds.indexOf('adre-2022-paper5') === -1) {
    window.ADRE_PAPERS.papers.push({
      id: 'adre-2022-paper5', edition: 'ADRE 1.0', year: 2022, paper_code: 'V',
      level: 'Driver (HSLC)', grade: 'Grade-III',
      title: 'ADRE 1.0 \u2014 2022 \u00b7 Paper V', subtitle: 'Driver Level \u2014 Grade III',
      total_questions: 150, total_marks: 150, marks_per_question: 1,
      duration_minutes: 180, negative_marking: 0.25,
      medium: 'Assamese, Bengali, Bodo, English, Hindi',
      verification_status: 'VERIFICATION_PENDING',
      source: 'Official SLRC-2022 Exam Pattern',
      published: false, questions_imported: false, questions: []
    });
  }

  console.log('[ADRE] Config loaded \u2014 ' + window.ADRE_PAPERS.papers.length + ' total paper(s) registered');
})();
