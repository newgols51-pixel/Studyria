-- ══════════════════════════════════════════════════════════════════
-- Studyria Blog — Seed Content (8 articles)
-- Run this in Supabase → SQL Editor (as the project owner / with the
-- service_role connection). The public anon key used by the website
-- cannot write to `blogs` (RLS blocks it — admin-only), so these
-- inserts must be run directly against the database.
-- Safe to run once. Re-running is safe too — it upserts on slug.
-- ══════════════════════════════════════════════════════════════════

insert into public.blogs (slug, title, content, published, featured_image)
values
(
  'how-to-prepare-for-adre-3-0-2026',
  'How to Prepare for ADRE 3.0 2026: A Complete Strategy',
  '<p>ADRE 3.0 is one of the most competitive recruitment exams in Assam, and with lakhs of candidates applying for a limited number of Grade III and Grade IV posts, a scattered approach simply will not work. Here is a focused, week-by-week strategy that actually moves the needle.</p>
   <h2>1. Know the exact syllabus before you touch a single book</h2>
   <p>ADRE tests General Knowledge (with heavy weightage on Assam), General English, Basic Computer Knowledge, and Reasoning/Numerical Ability. Print the official syllabus and tick off topics as you cover them — this alone prevents 80% of the panic that hits candidates in the last month.</p>
   <h2>2. Build a 60-day rolling revision cycle</h2>
   <p>Do not just move forward — revise backward. A simple rule: every Sunday, revise everything you studied Monday through Saturday in half the time it took to learn it.</p>
   <h2>3. Prioritise Assam-specific GK over generic GK</h2>
   <p>Assam History and Culture, Assam Geography, the Freedom Movement in Assam, and Assam''s administrative structure carry disproportionate weightage in ADRE compared to generic Indian GK. Study these first.</p>
   <h2>4. Practice previous years papers under timed conditions</h2>
   <p>Untimed practice builds false confidence. Sit for full-length mock tests with a timer, in one sitting, exactly as you would in the exam hall.</p>
   <h2>5. Do not neglect Basic Computer Knowledge</h2>
   <p>Many candidates skip this section assuming it is easy and lose easy marks. MS Office basics, internet fundamentals, and shortcut keys are frequently asked.</p>
   <p>Consistency beats intensity. A realistic 4 to 5 hour daily study plan sustained for 60 days will outperform sporadic 10-hour days followed by burnout.</p>',
  true,
  null
),
(
  'best-books-for-assam-police-si-exam',
  'Best Books & Resources for Assam Police SI Exam',
  '<p>Choosing the right books for the Assam Police Sub-Inspector (SI) exam can save you weeks of wasted effort. Here is a curated, no-fluff list organised by subject.</p>
   <h2>General Knowledge & Current Affairs</h2>
   <ul>
     <li>A dedicated Assam GK compilation covering history, geography, culture, and government schemes</li>
     <li>A monthly current affairs digest — focus on the last 6 months before your exam date</li>
     <li>Static GK: national symbols, awards, sports, and books and authors</li>
   </ul>
   <h2>Reasoning & Numerical Ability</h2>
   <ul>
     <li>A standard reasoning practice book covering verbal and non-verbal reasoning</li>
     <li>Basic arithmetic and data interpretation practice sets — SI exams favour speed over depth here</li>
   </ul>
   <h2>English & Assamese Language</h2>
   <ul>
     <li>Grammar fundamentals: tenses, articles, prepositions, and common error spotting</li>
     <li>Comprehension practice — read one passage daily and answer questions under a 5-minute limit</li>
   </ul>
   <h2>Physical Efficiency Test (PET) — do not ignore this</h2>
   <p>A huge number of otherwise well-prepared candidates get eliminated at the PET stage. Start your running and physical conditioning routine at least 2 months before the written exam, not after clearing it.</p>
   <p>Pair your books with topic-wise PDFs and timed mock tests — reading alone does not build exam speed, practice does.</p>',
  true,
  null
),
(
  'current-affairs-strategy-for-assam-exams',
  'Current Affairs Strategy for Assam Government Exams',
  '<p>Current affairs is the section where most candidates either waste the most time or leave the most marks on the table. Here is how to actually get it right.</p>
   <h2>Stop reading the newspaper cover to cover</h2>
   <p>It feels productive but it is not efficient. Instead, follow a single curated monthly current affairs summary and cross-reference it with Assam-specific news.</p>
   <h2>Build a last-6-months master sheet</h2>
   <p>Most exams draw current affairs questions from the 4 to 8 months before the exam date. Maintain a running one-page sheet per month covering important appointments, schemes launched, awards, sports events, and Assam government initiatives.</p>
   <h2>Assam-specific current affairs deserve their own category</h2>
   <p>State budget highlights, new district or circle announcements, Assam government flagship schemes, and CM or Governor statements on policy are asked far more often in Assam exams than in national-level exams.</p>
   <h2>Revise using active recall, not re-reading</h2>
   <p>At the end of each week, close your notes and try to write down everything you remember from that week''s current affairs. This single habit will outperform passive re-reading by a wide margin.</p>
   <p>Set aside 30 to 40 minutes daily, consistently, rather than cramming a month''s worth of news in the final week.</p>',
  true,
  null
),
(
  'apsc-prelims-beginners-roadmap',
  'APSC Prelims: A Beginner''s Roadmap',
  '<p>If you are just starting your APSC (Assam Public Service Commission) journey, the sheer scope of the syllabus can feel overwhelming. Here is a realistic roadmap for your first 90 days.</p>
   <h2>Days 1–15: Build your foundation</h2>
   <p>Read the complete official syllabus twice. Get an NCERT-level understanding of Indian Polity, Geography, Economy, and History before jumping to advanced material.</p>
   <h2>Days 16–45: Subject-wise deep dive</h2>
   <p>Move subject by subject: Assam History and Culture, Indian Polity, Geography (India and Assam), Economy, and General Science. Take structured notes as you go.</p>
   <h2>Days 46–75: Current affairs integration</h2>
   <p>Start layering current affairs on top of your static knowledge. Connect news events to the static topics you have already studied — this dual-linking dramatically improves recall.</p>
   <h2>Days 76–90: Mock tests and analysis</h2>
   <p>Begin full-length prelims mock tests. Spend more time analysing why you got questions wrong than taking the next test.</p>
   <p>APSC Prelims rewards breadth over depth — a working knowledge of many topics beats mastery of a few.</p>',
  true,
  null
),
(
  'assam-tet-preparation-guide',
  'Assam TET Preparation Guide: Paper 1 & Paper 2',
  '<p>The Assam Teacher Eligibility Test (TET) has a distinct structure for Paper 1 (Classes I–V) and Paper 2 (Classes VI–VIII). Here is how to prepare for each efficiently.</p>
   <h2>Common ground: Child Development & Pedagogy</h2>
   <p>This section is common to both papers and is highly scoring if prepared well. Focus on Piaget''s and Vygotsky''s theories, inclusive education, and learning assessment.</p>
   <h2>Paper 1 specifics</h2>
   <p>Emphasise foundational-level Language I and II, Mathematics pedagogy for primary classes, and Environmental Studies — a subject candidates often underestimate.</p>
   <h2>Paper 2 specifics</h2>
   <p>Choose your specialisation (Mathematics/Science or Social Studies) early and go deep. Practice previous year questions that test application, not just theory.</p>
   <h2>Assamese language component</h2>
   <p>Many candidates lose easy marks in the Assamese language section by not revising grammar basics. A quick 2-week grammar refresher close to the exam pays off disproportionately.</p>
   <p>TET rewards conceptual clarity in pedagogy over rote memorisation — always ask how a concept applies in a real classroom.</p>',
  true,
  null
),
(
  'top-10-mistakes-adre-exam',
  'Top 10 Mistakes Students Make in the ADRE Exam (And How to Avoid Them)',
  '<p>After looking at how thousands of candidates approach ADRE, a handful of avoidable mistakes come up again and again. Here they are, and how to fix each one.</p>
   <ol>
     <li>Starting too late — give yourself a minimum of 60 to 75 days of focused preparation.</li>
     <li>Ignoring the official syllabus and studying randomly from multiple sources.</li>
     <li>Skipping Assam-specific GK, the single biggest scoring gap for most candidates.</li>
     <li>No revision plan, meaning most material is forgotten by exam day.</li>
     <li>Avoiding mock tests until the last week instead of a month before.</li>
     <li>Underestimating Basic Computer Knowledge, an easy-to-score, often neglected section.</li>
     <li>Not analysing mistakes, which repeats the same errors test after test.</li>
     <li>Studying only from notes and never the original material.</li>
     <li>Poor time management in the exam hall from a lack of timed practice.</li>
     <li>Neglecting sleep and basic fitness in the final weeks before the exam.</li>
   </ol>
   <p>Fixing even three or four of these will meaningfully move your score.</p>',
  true,
  null
),
(
  'how-to-make-a-60-day-study-plan',
  'How to Make a 60-Day Study Plan for Any Government Exam',
  '<p>A good study plan is not about cramming more hours — it is about sequencing your effort correctly. Here is a framework that works for ADRE, APSC, Assam Police, or any similar exam.</p>
   <h2>Phase 1 (Days 1–20): Syllabus coverage</h2>
   <p>Your only goal in this phase is to touch every topic in the syllabus at least once, taking structured notes.</p>
   <h2>Phase 2 (Days 21–40): Depth and practice</h2>
   <p>Revisit each topic, this time going deeper and pairing it immediately with topic-wise practice questions.</p>
   <h2>Phase 3 (Days 41–55): Full-length mocks</h2>
   <p>Shift almost entirely to timed, full-length mock tests, at least one every 2 to 3 days, followed by thorough error analysis.</p>
   <h2>Phase 4 (Days 56–60): Light revision only</h2>
   <p>No new material. Just revise your existing notes, rest well, and keep your mind fresh for exam day.</p>
   <h2>Daily structure that actually works</h2>
   <p>Split your day into 3 blocks: new learning in the morning, practice and mock tests in the afternoon, and short evening revision. Protect at least 7 hours of sleep.</p>',
  true,
  null
),
(
  'assam-gk-topics-you-cannot-skip',
  'Assam GK: The Topics You Cannot Skip (Ranked)',
  '<p>Assam General Knowledge shows up across nearly every state-level competitive exam. Based on how frequently topics recur in past papers, here is a ranked list of what to prioritise.</p>
   <h2>1. Assam History & Freedom Movement</h2>
   <p>The Ahom dynasty, British annexation of Assam, and Assam''s role in India''s freedom movement are asked in almost every exam cycle.</p>
   <h2>2. Assam Geography</h2>
   <p>Rivers, especially the Brahmaputra system, districts, climate, and natural resources — a consistently high-yield area.</p>
   <h2>3. Assam Administrative & Political Structure</h2>
   <p>Districts, sub-divisions, current government schemes, and key constitutional provisions specific to Assam.</p>
   <h2>4. Culture, Festivals & Tribes</h2>
   <p>Bihu and other festivals, major tribal communities of Assam, classical and folk art forms, and important cultural personalities.</p>
   <h2>5. Current Affairs — Assam-specific</h2>
   <p>State budget highlights, new schemes, appointments, and recent government initiatives.</p>
   <h2>6. Economy of Assam</h2>
   <p>Tea industry, oil and natural gas, handloom and handicrafts, and major industrial hubs.</p>
   <p>Build a one-page summary sheet for each of these six areas and revise them on a weekly rotation.</p>',
  true,
  null
)
;
